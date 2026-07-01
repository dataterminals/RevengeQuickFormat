import { ReactNative } from "@vendetta/metro/common";

import type { Target } from "../types";

// ---------------------------------------------------------------------------
// Why targets exist
//
// On the web, Vencord's QuickCSS works because Discord is a DOM + CSS app: a
// selector like `.message-2CShn3` can reach any element. Discord mobile is
// React Native — no DOM, no stylesheet, no selectors. The only way to restyle
// an element is to intercept the component that renders it and merge a style in.
//
// A target is simply a *reference to a component*. The engine (apply.ts) patches
// React's element-creation path and, whenever an element of that exact component
// is created, injects the user's style. The most reliable targets are React
// Native's own primitives (Text, TextInput) — virtually all of Discord's UI
// bottoms out in these, and because there's a single RN module instance, the
// reference we resolve is the same one Discord renders with.
// ---------------------------------------------------------------------------

export const targets: Target[] = [
	{
		key: "text",
		label: "All text",
		description: "Every text element in the app, including message text.",
		status: "stable",
		resolve: () => (ReactNative as any)?.Text,
	},
	{
		key: "textInput",
		label: "Text inputs",
		description: "Every text input, including the chat composer.",
		status: "stable",
		resolve: () => (ReactNative as any)?.TextInput,
	},
];

export function getTarget(key: string): Target | undefined {
	return targets.find((t) => t.key === key);
}
