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
	// Resolve the component reference this target styles. The engine injects the
	// user's style whenever React creates an element of this exact component.
	// Returns null/undefined when the component can't be found.
	resolve(): unknown;
}
