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
// The most reliable ones hook React Native's own primitives (Text, TextInput):
// virtually all of Discord's UI bottoms out in these.
// ---------------------------------------------------------------------------

// Return a copy of a rendered element with `style` merged on top. Appending
// last means our props win on conflict. cloneElement avoids mutating (possibly
// frozen) element props.
function mergeStyle(element: any, style: StyleObject): any {
	if (!element?.props) return element;
	return React.cloneElement(element, {
		style: [element.props.style, style],
	});
}

// Patch a component's render output regardless of how the component is shaped.
// RN components come in a few forms across versions:
//   - forwardRef: the render fn is `owner.render`
//   - class:      the render fn is `owner.prototype.render`
// We try each and throw a descriptive error if none match, so the engine can
// report exactly why a target failed.
function patchRender(owner: any, style: StyleObject): Unpatch {
	if (typeof owner?.render === "function") {
		return after("render", owner, (_a: unknown[], r: any) => mergeStyle(r, style));
	}
	if (typeof owner?.prototype?.render === "function") {
		return after("render", owner.prototype, (_a: unknown[], r: any) =>
			mergeStyle(r, style),
		);
	}
	throw new Error(
		`no render fn (typeof=${typeof owner}, render=${typeof owner?.render}, proto.render=${typeof owner?.prototype?.render})`,
	);
}

function renderTarget(opts: {
	key: string;
	label: string;
	description: string;
	status: TargetStatus;
	find: () => any;
}): Target {
	return {
		key: opts.key,
		label: opts.label,
		description: opts.description,
		status: opts.status,
		apply(style: StyleObject): Unpatch {
			const owner = opts.find();
			if (!owner) throw new Error(`could not find component for "${opts.key}"`);
			return patchRender(owner, style);
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
		find: () => (ReactNative as any)?.Text,
	}),
	renderTarget({
		key: "textInput",
		label: "Text inputs",
		description: "Every text input, including the chat composer.",
		status: "stable",
		find: () => (ReactNative as any)?.TextInput,
	}),
];

export function getTarget(key: string): Target | undefined {
	return targets.find((t) => t.key === key);
}
