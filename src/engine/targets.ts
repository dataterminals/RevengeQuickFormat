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
		label: "Text (partial)",
		description:
			"Text rendered through Discord's own text component. Coverage is partial — see notes.",
		status: "experimental",
		// There is no single seam for text on this build, and this target is
		// honest about being partial.
		//
		// Measured on 342.16 over one screen: ReactNative.Text is never rendered
		// as an element type at all (styling it does nothing, anywhere). The
		// native host "RCTText" appears only twice, because React Native creates
		// those elements inside its own module and they never pass through the
		// jsx runtime we patch. Discord's design-system text component accounts
		// for the rest — but it is an anonymous forwardRef with no displayName
		// and no findable export, so it cannot be resolved by reference and is
		// matched on its prop shape instead.
		//
		// The refs are kept alongside the predicate so anything that does render
		// through them is still covered.
		resolve: () => ["RCTText", (ReactNative as any)?.Text],
		match: (type: any, props: any) =>
			typeof type === "object" &&
			type !== null &&
			props != null &&
			props.variant !== undefined &&
			props.children !== undefined,
	},
	{
		key: "textInput",
		label: "Text inputs",
		description: "Every text input, including the chat composer.",
		status: "experimental",
		// Same reasoning as above; the host name differs by platform, so all the
		// plausible ones are registered and whichever exists will match.
		resolve: () => [
			"RCTSinglelineTextInputView",
			"RCTMultilineTextInputView",
			"AndroidTextInput",
			(ReactNative as any)?.TextInput,
		],
	},
];

export function getTarget(key: string): Target | undefined {
	return targets.find((t) => t.key === key);
}
