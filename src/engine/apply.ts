import { React } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { before } from "@vendetta/patcher";

import { getTarget } from "./targets";
import { findBlockedUserId, parseUserTarget } from "./match";
import type { Sheet, StyleObject, Unpatch } from "../types";

// ---------------------------------------------------------------------------
// Injection engine
//
// React 19 dropped forwardRef for many RN primitives, so Text/TextInput are now
// plain function components with no patchable `render`. Instead of patching each
// component, we patch React's element-creation path once (createElement plus the
// automatic `jsx`/`jsxs` runtime) and merge a style into elements as they're
// created.
//
// Two kinds of override are applied in that one hook:
//
//   • element targets — keyed by a component reference (e.g. RN.Text). Every
//     element of that exact component gets the style merged in. Because there's
//     a single React Native module instance, the reference we resolve is the
//     same one Discord renders with, so the match hits Discord's own elements.
//
//   • user targets — keyed by a Discord user id. An element that belongs to that
//     user (a message row, matched by the real author id, or an avatar image,
//     matched by its URL) gets the style merged in. A style of { display: "none" }
//     drops it from React Native's layout — the mobile stand-in for the desktop
//     `:has([src*='<id>']) { display: none }`, and because layout collapses there
//     is no leftover gap.
//
// We always *merge a style*, never replace the component. Swapping a hook-using
// component for a render-nothing one changes React's hook count at that tree
// position and throws "rendered fewer hooks than expected" — which froze the app
// after opening a hidden user's DM. Merging a style keeps the element mounted
// (its hooks/effects/subscriptions intact) and simply hides it.
// ---------------------------------------------------------------------------

// component reference -> styles to inject onto it
let componentOverrides = new Map<unknown, StyleObject[]>();
// user id -> style to inject onto anything belonging to that user
let userOverrides = new Map<string, StyleObject>();
// key set of userOverrides, for a cheap size check in the hot path
let blockedIds = new Set<string>();
// installed element-creation patches
let patches: Unpatch[] = [];

export interface ApplyResult {
	applied: string[];
	skipped: string[];
	failed: { key: string; reason: string }[];
}

// Merge styles into a props object, appending last so they win on conflict.
function mergeStyle(props: any, styles: StyleObject[]): any {
	const base = props ?? {};
	return { ...base, style: [base.style, ...styles] };
}

// spitroast `before` hook: element-creation calls look like (type, props, ...).
// Returning a new args array replaces the arguments; returning nothing leaves
// them untouched. Wrapped so a matching error can never escape into a render.
function hook(args: any[]): any[] | undefined {
	if (!args?.length) return;
	try {
		const type = args[0];
		const props = args[1];

		// User targets: an element that belongs to a targeted user.
		if (blockedIds.size) {
			const uid = findBlockedUserId(props, blockedIds);
			if (uid) {
				const next = args.slice();
				next[1] = mergeStyle(props, [userOverrides.get(uid)!]);
				return next;
			}
		}

		// Element targets: a component we style wholesale.
		const styles = componentOverrides.get(type);
		if (styles) {
			const next = args.slice();
			next[1] = mergeStyle(props, styles);
			return next;
		}
	} catch {
		// Never let a matching error break Discord's render.
	}
	return;
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
	componentOverrides = new Map();
	userOverrides = new Map();
	blockedIds = new Set();
	uninstall();
}

// Apply a parsed sheet. Safe to call repeatedly.
export function applySheet(sheet: Sheet): ApplyResult {
	componentOverrides = new Map();
	userOverrides = new Map();
	blockedIds = new Set();
	const result: ApplyResult = { applied: [], skipped: [], failed: [] };

	for (const [key, style] of Object.entries(sheet)) {
		// user:<id> target — no component to resolve, so it always "applies".
		const userId = parseUserTarget(key);
		if (userId) {
			userOverrides.set(userId, style);
			blockedIds.add(userId);
			result.applied.push(key);
			continue;
		}

		const target = getTarget(key);
		if (!target) {
			result.skipped.push(key);
			continue;
		}
		try {
			const component = target.resolve();
			if (!component) throw new Error(`component for "${key}" not found`);
			const arr = componentOverrides.get(component) ?? [];
			arr.push(style);
			componentOverrides.set(component, arr);
			result.applied.push(key);
		} catch (e) {
			result.failed.push({ key, reason: (e as Error).message });
		}
	}

	if (componentOverrides.size > 0 || userOverrides.size > 0) install();
	else uninstall();

	return result;
}
