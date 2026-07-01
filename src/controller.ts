import { applySheet, clear } from "./engine/apply";
import { parseSheet } from "./engine/parser";
import { vstorage } from "./storage";

// Re-evaluate the current sheet and (re)apply it. Called on load and whenever
// the user toggles the plugin or saves the editor. Lives in its own module so
// both the entry point and the settings UI can import it without a cycle.
export function reapply(): void {
	clear();
	if (!vstorage.enabled) return;
	const { sheet } = parseSheet(vstorage.source);
	applySheet(sheet, (msg) => console.warn(`[QuickFormat] ${msg}`));
}

export { clear };
