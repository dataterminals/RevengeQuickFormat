import { targets } from "./targets";
import type { ParseResult, Sheet, StyleObject } from "../types";

// Strip `//` line comments and trailing commas so the sheet can be authored as
// friendly JSONC rather than strict JSON. String-aware so `//` and commas
// inside string values (e.g. URLs) are preserved.
function stripJsonc(input: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	let inLineComment = false;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		const next = input[i + 1];

		if (inLineComment) {
			if (ch === "\n") {
				inLineComment = false;
				out += ch;
			}
			continue;
		}

		if (inString) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}

		if (ch === '"') {
			inString = true;
			out += ch;
			continue;
		}

		if (ch === "/" && next === "/") {
			inLineComment = true;
			continue;
		}

		out += ch;
	}

	// Remove trailing commas before } or ].
	return out.replace(/,(\s*[}\]])/g, "$1");
}

// Parse and validate a sheet source string. Never throws.
export function parseSheet(source: string): ParseResult {
	const errors: string[] = [];
	const sheet: Sheet = {};

	const trimmed = source?.trim();
	if (!trimmed) return { sheet, errors };

	let raw: unknown;
	try {
		raw = JSON.parse(stripJsonc(source));
	} catch (e) {
		return { sheet, errors: [`Invalid JSON: ${(e as Error).message}`] };
	}

	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { sheet, errors: ["Sheet must be an object mapping target keys to style objects."] };
	}

	const knownKeys = new Set(targets.map((t) => t.key));

	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			errors.push(`"${key}": value must be a style object.`);
			continue;
		}
		if (!knownKeys.has(key)) {
			errors.push(`"${key}": unknown target (it will be ignored).`);
			continue;
		}
		sheet[key] = value as StyleObject;
	}

	return { sheet, errors };
}
