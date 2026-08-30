import { ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

import { type ApplyResult, applySheet, clear } from "./engine/apply";
import { parseSheet } from "./engine/parser";
import { vstorage } from "./storage";
import type { Sheet } from "./types";

// The outcome of the most recent apply, so the settings UI can show exactly
// what happened (which keys applied / were unknown / failed and why).
let last: ApplyResult | null = null;
export function getLastResult(): ApplyResult | null {
	return last;
}

// ---------------------------------------------------------------------------
// Why saving a sheet reloads the app
//
// Nothing in this plugin can make Discord re-render on demand. Every override
// is applied inside the element-creation hook, so it takes effect only when
// React creates the element — and React only does that when some piece of app
// state genuinely changes. A saved sheet is therefore correct in memory and
// invisible on screen until something remounts, which is why the plugin used to
// need a force-quit before an edit showed up, in both directions.
//
// Measured on 342.16, with the recorder used as an instrument — clear it, fire
// the candidate, and see whether anything re-rendered:
//
//   emitChange() on PrivateChannelSortStore, ChannelStore, RelationshipStore,
//   UserStore, ReadStateStore, SelectedChannelStore    ->  0 elements, each
//
//   a real Flux action (CHANNEL_SELECT)                ->  64 elements once,
//                                                          then 0 on a repeat
//
// The lists are `React.memo` and a subscription that recomputes identical data
// is dropped before any element is created; an action that does not change
// state does nothing at all. So there is no targeted lever here. The remaining
// options were to forge a state change — which is exactly what the predecessor
// plugin did, with CHANNEL_DELETE storms and staggered re-hide sweeps, and what
// this one exists to avoid — or to reload.
//
// Reloading the JS bundle is the honest version of what the user was already
// doing by hand. It costs a couple of seconds and comes back to Discord's usual
// landing screen.
// ---------------------------------------------------------------------------

// What was last applied, so that saving an unchanged sheet does not reload.
// Null until the first apply, which happens on load and never reloads.
let appliedSignature: string | null = null;

function signatureOf(enabled: boolean, sheet: Sheet): string {
	// Cannot collide with an enabled signature: that is always a JSON array.
	if (!enabled) return "disabled";
	// Sorted, so reordering or re-commenting a sheet is not a change.
	const keys = Object.keys(sheet).sort();
	return JSON.stringify(keys.map((k) => [k, sheet[k]]));
}

// Reload the JS bundle. Returns false when neither mechanism is reachable, so
// the caller can ask for a manual restart rather than silently doing nothing.
function reloadBundle(): boolean {
	const RN = ReactNative as any;
	const updater = RN?.NativeModules?.BundleUpdaterManager;
	if (typeof updater?.reload === "function") {
		updater.reload();
		return true;
	}
	if (typeof RN?.DevSettings?.reload === "function") {
		RN.DevSettings.reload();
		return true;
	}
	return false;
}

// Re-evaluate the current sheet and (re)apply it. Called on load and whenever
// the user toggles the plugin or saves the editor. Lives in its own module so
// both the entry point and the settings UI can import it without a cycle.
//
// `notify` shows an on-device toast summary on user actions; off by default so
// app launches stay quiet.
export function reapply(notify = false): void {
	clear();

	const enabled = !!vstorage.enabled;
	const { sheet, errors } = enabled
		? parseSheet(vstorage.source)
		: { sheet: {} as Sheet, errors: [] as string[] };

	if (enabled) {
		const result = applySheet(sheet);
		last = result;
		for (const msg of errors) console.warn(`[QuickFormat] ${msg}`);
		for (const f of result.failed) console.warn(`[QuickFormat] ${f.key}: ${f.reason}`);
	} else {
		last = null;
	}

	// On load there is nothing on screen to correct yet and no previous sheet to
	// compare against, so record what we applied and leave the app alone.
	const signature = signatureOf(enabled, sheet);
	const previous = appliedSignature;
	appliedSignature = signature;
	if (!notify) return;

	// What is already rendered is only stale if the sheet actually changed. Saving
	// an untouched sheet, or one edited only in its comments, should not reload.
	const stale = previous !== null && previous !== signature;

	if (!enabled) {
		showToast(stale ? "QuickFormat: disabled, reloading…" : "QuickFormat: disabled");
	} else {
		const parts = [`${last!.applied.length} applied`];
		if (last!.skipped.length) parts.push(`${last!.skipped.length} unknown`);
		if (last!.failed.length) parts.push(`${last!.failed.length} failed`);
		if (stale) parts.push("reloading…");
		showToast(`QuickFormat: ${parts.join(", ")}`);
	}

	if (!stale) return;

	// See the note above for why a reload is the only honest way to fix that.
	// Delayed so the toast is readable first.
	setTimeout(() => {
		if (!reloadBundle()) showToast("QuickFormat: restart Discord to see the change");
	}, 900);
}

export { clear };
