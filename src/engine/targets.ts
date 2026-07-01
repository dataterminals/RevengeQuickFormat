import { React, ReactNative } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";

import type { StyleObject, Target, TargetStatus, Unpatch } from "../types";

// ---------------------------------------------------------------------------
// Why targets exist
//
// On the web, Vencord's QuickCSS works because Discord is a DOM + CSS app: a
// selector like `.message-2CShn3` can reach any element. Discord mobile is
// React Native — no DOM, no stylesheet, no selectors. The only way to restyle
// an element is to intercept the component that renders it and merge a style
// into what it returns.
//
// So instead of selectors, QuickFormat exposes a curated registry of *targets*.
// Each target is a binding that knows how to find one piece of the UI and inject
// a style into it. Users reference a target by its `key` in their sheet.
//
// The most reliable targets hook React Native's own primitives (Text,
// TextInput): virtually all of Discord's UI bottoms out in these, so patching
// them is stable across Discord versions. Targets that reach for a specific
// Discord-internal component are marked "experimental".
// ---------------------------------------------------------------------------

// Return a copy of a rendered element with `style` merged on top of whatever it
// already had. Appending last means our props win on conflict. cloneElement
// avoids mutating (possibly frozen) element props.
function mergeStyle(element: any, style: StyleObject): any {
	if (!element?.props) return element;
	return React.cloneElement(element, {
		style: [element.props.style, style],
	});
}

// Build a target that patches `owner[method]` (a render function) and merges
// `style` into its output. `find` locates the owner/method at apply time; if it
// returns null the target throws so the engine can report it as failed rather
// than silently doing nothing.
function renderTarget(opts: {
	key: string;
	label: string;
	description: string;
	status: TargetStatus;
	find: () => { owner: any; method: string } | null;
}): Target {
	return {
		key: opts.key,
		label: opts.label,
		description: opts.description,
		status: opts.status,
		apply(style: StyleObject): Unpatch {
			const found = opts.find();
			if (!found || typeof found.owner?.[found.method] !== "function") {
				throw new Error(`could not locate component for "${opts.key}"`);
			}
			return after(found.method, found.owner, (_args: unknown[], ret: any) =>
				mergeStyle(ret, style),
			);
		},
	};
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const targets: Target[] = [
	renderTarget({
		key: "text",
		label: "All text",
		description: "Every text element in the app, including message text.",
		status: "stable",
		// RN's Text is a forwardRef component, so its render fn lives on `.render`.
		find: () => {
			const owner = ReactNative.Text as any;
			return owner?.render ? { owner, method: "render" } : null;
		},
	}),
	renderTarget({
		key: "textInput",
		label: "Text inputs",
		description: "Every text input, including the chat composer.",
		status: "stable",
		find: () => {
			const owner = ReactNative.TextInput as any;
			return owner?.render ? { owner, method: "render" } : null;
		},
	}),
];

export function getTarget(key: string): Target | undefined {
	return targets.find((t) => t.key === key);
}
