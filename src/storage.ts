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
	'\t// Map a target key (see "Available targets" below) to a React Native',
	'\t// style object. Tap "Save & apply" to see changes live.',
	'\t// Try uncommenting this:',
	'\t// "text": { "fontSize": 18, "color": "#ff5555" }',
	"}",
].join("\n");

// Fill in defaults for any missing fields. Safe to call on every load.
export function initStorage(): void {
	vstorage.enabled ??= true;
	vstorage.source ??= DEFAULT_SOURCE;
}
