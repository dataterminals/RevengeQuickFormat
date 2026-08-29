// A single React Native style object, e.g. { "color": "#ff0000", "fontSize": 18 }.
// Values are intentionally loose here; the target that consumes them decides
// which props are meaningful.
export type StyleObject = Record<string, unknown>;

// A parsed QuickFormat sheet: a map of target key -> style overrides. A key is
// either an element target (e.g. "text") or a user target ("user:<id>"), which
// styles everything belonging to that user — { "display": "none" } hides them.
//
//   {
//     "text":                       { "fontSize": 18, "fontWeight": "600" },
//     "user:240617625594494977":    { "display": "none" }
//   }
export type Sheet = Record<string, StyleObject>;

export interface ParseResult {
	// The validated sheet (only well-formed entries survive).
	sheet: Sheet;
	// Human-readable problems found while parsing. A non-empty list does not
	// necessarily mean nothing applied — unknown keys are reported but skipped.
	errors: string[];
}

// The lifecycle of a single applied override. Calling it reverts the patch.
export type Unpatch = () => void;

export type TargetStatus = "stable" | "experimental";

export interface Target {
	// The key users reference in their sheet.
	key: string;
	// Short human label for the settings UI.
	label: string;
	// One-line explanation of what this target styles.
	description: string;
	// "experimental" targets depend on Discord internals that may shift between
	// app versions and need on-device verification.
	status: TargetStatus;
	// Resolve the component reference(s) this target styles. May return a single
	// reference or an array of them — a native host component and the JS wrapper
	// over it, for instance — and every one that resolves gets the style. Return
	// null/undefined when the component can't be found.
	//
	// Optional, because some components cannot be resolved at all: Discord's own
	// text component is an anonymous forwardRef with no displayName and no
	// findable export, so there is no reference to hold on to. Such a target
	// supplies `match` instead.
	resolve?(): unknown | unknown[];
	// Predicate alternative to `resolve`, tested against every element created.
	// Keep it cheap — it runs on every element the app renders.
	match?(type: unknown, props: any): boolean;
}
