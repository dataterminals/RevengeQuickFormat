import { React } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { before } from "@vendetta/patcher";

import { getTarget } from "./targets";
import type { Sheet, StyleObject, Unpatch } from "../types";

// ---------------------------------------------------------------------------
// Injection engine
//
// React 19 dropped forwardRef for many RN primitives, so Text/TextInput are now
// plain function components with no patchable `render`. Instead of patching each
// component, we patch React's element-creation path once (createElement plus the
// automatic `jsx`/`jsxs` runtime) and, whenever an element's `type` matches a
// component we have overrides for, we merge the style into its props.
//
// Because there's a single React Native module instance, the component we
// resolve from `ReactNative.Text` is the very same reference Discord renders
// with, so the `type === component` match hits Discord's own elements.
// ---------------------------------------------------------------------------

// component reference -> styles to inject onto it
let overrides = new Map<unknown, StyleObject[]>();
// installed element-creation patches
let patches: Unpatch[] = [];

export interface ApplyResult {
	applied: string[];
	skipped: string[];
	failed: { key: string; reason: string }[];
}

// Merge our styles into a props object, appending last so they win on conflict.
function withOverride(type: unknown, props: any): any {
	const styles = overrides.get(type);
	if (!styles) return props;
	const base = props ?? {};
	return { ...base, style: [base.style, ...styles] };
}

// spitroast `before` hook: element-creation calls look like (type, props, ...).
// Returning a new args array replaces the arguments; returning nothing leaves
// them untouched.
function hook(args: any[]): any[] | undefined {
	if (!args?.length) return;
	const type = args[0];
	if (!overrides.has(type)) return;
	const next = args.slice();
	next[1] = withOverride(type, args[1]);
	return next;
}

function install(): void {
	if (patches.length) return;
	const add = (fn: string, parent: any) => {
		if (parent && typeof parent[fn] === "function") {
			patches.push(before(fn, parent, hook));
		}
	};
	// Classic runtime.
	add("createElement", React);
	// Automatic runtime (react/jsx-runtime) and its dev variant.
	add("jsx", findByProps("jsx", "jsxs"));
	add("jsxs", findByProps("jsx", "jsxs"));
	add("jsxDEV", findByProps("jsxDEV"));
}

function uninstall(): void {
	for (const undo of patches.splice(0)) {
		try {
			undo();
		} catch (e) {
			console.warn("[QuickFormat] failed to remove a patch:", e);
		}
	}
}

// Revert every applied override.
export function clear(): void {
	overrides = new Map();
	uninstall();
}

// Apply a parsed sheet. Safe to call repeatedly.
export function applySheet(sheet: Sheet): ApplyResult {
	overrides = new Map();
	const result: ApplyResult = { applied: [], skipped: [], failed: [] };

	for (const [key, style] of Object.entries(sheet)) {
		const target = getTarget(key);
		if (!target) {
			result.skipped.push(key);
			continue;
		}
		try {
			const component = target.resolve();
			if (!component) throw new Error(`component for "${key}" not found`);
			const arr = overrides.get(component) ?? [];
			arr.push(style);
			overrides.set(component, arr);
			result.applied.push(key);
		} catch (e) {
			result.failed.push({ key, reason: (e as Error).message });
		}
	}

	if (overrides.size > 0) install();
	else uninstall();

	return result;
}
