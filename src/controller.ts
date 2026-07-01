import { showToast } from "@vendetta/ui/toasts";

import { type ApplyResult, applySheet, clear } from "./engine/apply";
import { parseSheet } from "./engine/parser";
import { vstorage } from "./storage";

// The outcome of the most recent apply, so the settings UI can show exactly
// what happened (which keys applied / were unknown / failed and why).
let last: ApplyResult | null = null;
export function getLastResult(): ApplyResult | null {
	return last;
}

// Re-evaluate the current sheet and (re)apply it. Called on load and whenever
// the user toggles the plugin or saves the editor. Lives in its own module so
// both the entry point and the settings UI can import it without a cycle.
//
// `notify` shows an on-device toast summary on user actions; off by default so
// app launches stay quiet.
export function reapply(notify = false): void {
	clear();

	if (!vstorage.enabled) {
		last = null;
		if (notify) showToast("QuickFormat: disabled");
		return;
	}

	const { sheet, errors } = parseSheet(vstorage.source);
	const result = applySheet(sheet);
	last = result;

	for (const msg of errors) console.warn(`[QuickFormat] ${msg}`);
	for (const f of result.failed) console.warn(`[QuickFormat] ${f.key}: ${f.reason}`);

	if (notify) {
		const parts = [`${result.applied.length} applied`];
		if (result.skipped.length) parts.push(`${result.skipped.length} unknown`);
		if (result.failed.length) parts.push(`${result.failed.length} failed`);
		showToast(`QuickFormat: ${parts.join(", ")}`);
	}
}

export { clear };
