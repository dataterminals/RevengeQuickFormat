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
	{
		key: "icon",
		label: "Icons",
		description: "The small glyphs throughout the UI — channel, toolbar and badge icons.",
		status: "experimental",
		// `BaseIconImage` was the most-rendered named component in the sweep after
		// the layout primitives (139 elements), and it takes a real `style` prop,
		// which is what makes it stylable at all — plenty of Discord's components
		// route their styling through their own props (`textStyle`, `containerStyle`)
		// and ignore anything merged into `style`.
		//
		// It is matched by name rather than resolved, because `findByName` cannot
		// see it: the component has a name at render time, but
		// `findByNameAll("BaseIconImage")` returns nothing on this build. Reading it off
		// the type is the cheapest way to reach a component in that position.
		match: (type: any) => typeof type === "function" && type.name === "BaseIconImage",
	},
];

// ---------------------------------------------------------------------------
// Not a target (yet): usernames.
//
// The recorder does find username components — three anonymous memo shapes on
// 342.16, all carrying `userId` + `userName` + `style`, plus a named
// `Username{userId,username}` using the other spelling:
//
//   {effectDisplayType,ellipsizeMode,lineClamp,style,userId,userName,variant}
//   {containerStyle,defaultColor,ellipsizeMode,lineClamp,maxFontSizeMultiplier,style,userId,userName,variant}
//   {accessibilityLabel,accessibilityRole,containerStyle,defaultColor,guildId,lineClamp,maxFontSizeMultiplier,style,userId,userName,variant}
//
// A `userId`+`userName` predicate matches them, and it was left out anyway,
// because it did not style anything a user would point at. **Message author
// names are drawn by `host:DCDChat`** — the message list is native, and no
// author name was seen passing through the jsx runtime on 342.16, the same as
// message text. What is left renders once or twice a screen and was not caught
// visibly changing across four verification runs.
//
// Both of those are what the recorder saw, not proof of what cannot exist —
// the DM list, `DMRow` and `SearchList` were each written up as absent before
// better tooling found them.
//
// A knob that does nothing is worse than no knob, so this is a finding rather
// than a target. Reaching author names needs the RowManager seam that the
// message hiding already uses, not an element predicate.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Not a target: images.
//
// `ReactNative.Image` looks like the obvious win — the recorder counted 222
// `Image` elements over one sweep, it resolves cleanly, and it would cover
// avatars, emoji and attachments in one go. Registering it destabilises the
// app. React Native uses that component internally, and merging a style array
// into its props breaks its own handling of `defaultSource`, producing an
// endless flood of
//
//   ReactImageView: Only local resources can be used as default image. Uri: res:/…
//
// until Discord goes down. Verified on 342.16, twice. If images are ever worth
// revisiting, it needs a narrower seam than the shared RN primitive.
// ---------------------------------------------------------------------------

export function getTarget(key: string): Target | undefined {
	return targets.find((t) => t.key === key);
}
