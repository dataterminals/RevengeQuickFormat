import { getTarget } from "./targets";
import type { Sheet, Unpatch } from "../types";

// Every patch currently applied by the engine. Kept module-local so a reload or
// disable can cleanly revert everything.
let active: Unpatch[] = [];

export interface ApplyResult {
	// Target keys that patched successfully.
	applied: string[];
	// Keys in the sheet that don't correspond to any known target.
	skipped: string[];
	// Keys whose target threw while binding, with the reason.
	failed: { key: string; reason: string }[];
}

// Revert every applied override.
export function clear(): void {
	const toUndo = active;
	active = [];
	for (const undo of toUndo) {
		try {
			undo();
		} catch (e) {
			console.warn("[QuickFormat] failed to revert an override:", e);
		}
	}
}

// Apply a parsed sheet. Clears any previously applied overrides first, so this
// is safe to call repeatedly (e.g. after every save).
export function applySheet(sheet: Sheet): ApplyResult {
	clear();
	const result: ApplyResult = { applied: [], skipped: [], failed: [] };

	for (const [key, style] of Object.entries(sheet)) {
		const target = getTarget(key);
		if (!target) {
			result.skipped.push(key);
			continue;
		}
		try {
			active.push(target.apply(style));
			result.applied.push(key);
		} catch (e) {
			result.failed.push({ key, reason: (e as Error).message });
		}
	}

	return result;
}
