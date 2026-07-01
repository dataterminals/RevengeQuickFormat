import { getTarget } from "./targets";
import type { Sheet, Unpatch } from "../types";

// Every patch currently applied by the engine. Kept module-local so a reload or
// disable can cleanly revert everything.
let active: Unpatch[] = [];

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
// is safe to call repeatedly (e.g. after every save). `log` receives
// non-fatal, human-readable problems.
export function applySheet(sheet: Sheet, log?: (msg: string) => void): void {
	clear();
	for (const [key, style] of Object.entries(sheet)) {
		const target = getTarget(key);
		if (!target) {
			log?.(`Unknown target "${key}"`);
			continue;
		}
		try {
			active.push(target.apply(style));
		} catch (e) {
			log?.(`Failed to apply "${key}": ${(e as Error).message}`);
		}
	}
}
