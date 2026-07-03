import { React, ReactNative } from "@vendetta/metro/common";
import { findByName, findByProps } from "@vendetta/metro";
import { showToast } from "@vendetta/ui/toasts";

// Report the shape of the runtime objects QuickFormat needs to patch, so we can
// figure out the correct binding without a full debug console. This is the
// mobile stand-in for poking around in DevTools.
function probe(label: string, obj: any): string {
	if (obj == null) return `${label}: <${obj}>`;
	const name = obj.displayName || obj.name || "?";
	const sym = obj.$$typeof ? String(obj.$$typeof) : "-";
	return `${label}: type=${typeof obj} name=${name} $$typeof=${sym} render=${typeof obj.render} proto.render=${typeof obj?.prototype?.render}`;
}

export function runDiagnostics(): string {
	const RN: any = ReactNative;
	const lines: string[] = [];
	lines.push(`React=${(React as any)?.version ?? "?"} RN=${typeof RN}`);
	lines.push(probe("RN.Text", RN?.Text));
	lines.push(probe("RN.TextInput", RN?.TextInput));
	lines.push(probe("RN.View", RN?.View));

	// Element-creation entry points the injection engine patches.
	try {
		const rt: any = findByProps("jsx", "jsxs");
		const dev: any = findByProps("jsxDEV");
		lines.push(
			`createElement=${typeof (React as any)?.createElement} jsx=${typeof rt?.jsx} jsxs=${typeof rt?.jsxs} jsxDEV=${typeof dev?.jsxDEV}`,
		);
	} catch (e) {
		lines.push(`jsx runtime err ${(e as Error).message}`);
	}

	// Discord ships its own design-system Text; it may be the real target.
	try {
		const p: any = findByProps("Text", "View");
		lines.push(
			`findByProps(Text,View)=${
				p ? "found keys:" + Object.keys(p).slice(0, 8).join(",") : "null"
			}`,
		);
		if (p?.Text) lines.push(probe("  ↳ .Text", p.Text));
	} catch (e) {
		lines.push(`findByProps err ${(e as Error).message}`);
	}

	// Breadcrumbs for user-target surfaces. Prop-level matching (match.ts) is the
	// primary path; these help if we need to bind a specific module instead —
	// e.g. the message-row builder or the avatar-URL helper.
	try {
		const rm: any = findByName("RowManager", false);
		lines.push(`RowManager=${rm ? "found" : "null"}`);
		const av: any = findByProps("getUserAvatarURL");
		lines.push(
			`avatarUtils=${av ? "found keys:" + Object.keys(av).slice(0, 6).join(",") : "null"}`,
		);
	} catch (e) {
		lines.push(`user-surface probe err ${(e as Error).message}`);
	}

	return lines.join("\n");
}

// Copy the diagnostics to the clipboard (via the metro Clipboard module) so it
// can be pasted back for debugging.
export function copyDiagnostics(): void {
	const report = runDiagnostics();
	console.log("[QuickFormat] diagnostics:\n" + report);
	try {
		const Clipboard: any = findByProps("setString", "getString");
		Clipboard.setString(report);
		showToast("QuickFormat: diagnostics copied");
	} catch {
		showToast("QuickFormat: copy failed (logged to console)");
	}
}
