import { storage } from "@vendetta/plugin";

// Persisted plugin state. Revenge/Vendetta gives every plugin a reactive
// `storage` object that is automatically saved; we just give it a type.
export interface QuickFormatStorage {
	// Master on/off switch for the whole sheet.
	enabled: boolean;
	// The raw sheet source the user edits (JSON text).
	source: string;
}

export const vstorage = storage as unknown as QuickFormatStorage;

export const DEFAULT_SOURCE = [
	"{",
	"\t// A QuickFormat sheet maps a target to a React Native style object.",
	'\t// Tap "Save & apply" to see changes live. Two kinds of target:',
	"\t//",
	'\t//   • element targets (see "Available targets"): "text", "textInput"',
	'\t//   • user targets: "user:<id>" styles everything from one user — their',
	'\t//     messages, member-list row, avatar, etc. { "display": "none" } hides',
	"\t//     them entirely; any other style just restyles them.",
	"\t//",
	"\t// Examples (uncomment to try):",
	'\t// "text": { "fontSize": 18, "color": "#ff5555" },',
	'\t// "user:000000000000000000": { "display": "none" }',
	"}",
].join("\n");

// Fill in defaults for any missing fields. Safe to call on every load.
export function initStorage(): void {
	vstorage.enabled ??= true;
	vstorage.source ??= DEFAULT_SOURCE;
}
