import { findByName, findByProps } from "@vendetta/metro";
import { after } from "@vendetta/patcher";

import type { StyleObject, Target, Unpatch } from "../types";

// ---------------------------------------------------------------------------
// Why targets exist
//
// On the web, Vencord's QuickCSS works because Discord is a DOM + CSS app: a
// selector like `.message-2CShn3` can reach any element. Discord mobile is
// React Native — there is no DOM, no stylesheet, and no selectors. The only way
// to restyle an element is to intercept the component that renders it and merge
// a style into what it returns.
//
// So instead of selectors, QuickFormat exposes a curated registry of *targets*.
// Each target is a hand-written binding that knows how to find one piece of
// Discord's UI and inject a style into it. Users reference a target by its
// `key` in their sheet; the engine calls `apply(style)`.
//
// Targets marked "experimental" depend on Discord-internal component names that
// can change between app versions. They MUST be verified on-device; when the
// underlying module can't be found they no-op (never crash).
// ---------------------------------------------------------------------------

// Merge `style` into a rendered React element's `style` prop, in place.
function mergeStyle(element: any, style: StyleObject): any {
	if (!element || !element.props) return element;
	const existing = element.props.style;
	element.props.style =
		existing == null ? style : ([] as unknown[]).concat(existing, style);
	return element;
}

// Helper: build a target that finds a component module and merges `style` into
// its render output via an `after` patch. `find` should return the object that
// owns the render function and the property name to patch (usually the exports
// object and "default", or a prototype and "render").
function renderTarget(opts: {
	key: string;
	label: string;
	description: string;
	find: () => { owner: any; method: string } | null;
}): Target {
	return {
		key: opts.key,
		label: opts.label,
		description: opts.description,
		status: "experimental",
		apply(style: StyleObject): Unpatch {
			const found = opts.find();
			if (!found || !found.owner || typeof found.owner[found.method] !== "function") {
				console.warn(
					`[QuickFormat] target "${opts.key}" could not locate its component; skipping.`,
				);
				return () => {};
			}
			return after(found.method, found.owner, (_args: unknown[], ret: any) =>
				mergeStyle(ret, style),
			);
		},
	};
}

// ---------------------------------------------------------------------------
// Registry
//
// Start small and honest. Each entry below is a starting point that needs
// on-device confirmation of its module binding. Adding a new target is just
// appending to this array.
// ---------------------------------------------------------------------------
export const targets: Target[] = [
	renderTarget({
		key: "messageText",
		label: "Message text",
		description: "Text content of chat messages.",
		find: () => {
			// Discord renders message markdown through a component often exported
			// as the default of a module discoverable by these props. VERIFY on device.
			const mod = findByProps("MessageContent")?.MessageContent;
			return mod ? { owner: mod, method: "type" } : null;
		},
	}),
	renderTarget({
		key: "chatInput",
		label: "Chat input",
		description: "The message composer / text box at the bottom of a channel.",
		find: () => {
			const mod = findByName("ChatInput", false);
			const component = mod?.default ?? mod;
			return component ? { owner: mod, method: mod?.default ? "default" : "render" } : null;
		},
	}),
];

export function getTarget(key: string): Target | undefined {
	return targets.find((t) => t.key === key);
}
