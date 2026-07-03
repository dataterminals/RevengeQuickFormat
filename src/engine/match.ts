// ---------------------------------------------------------------------------
// User matching — the mobile stand-in for the desktop CSS `[src*='<id>']`.
//
// On the web, QuickCSS hides a user by matching their avatar URL and walking up
// with `:has(...)`. React Native has no selectors and no DOM to walk, but it
// does hand us the real component props at element-creation time — which usually
// carry the author/user id directly. Matching that id is both more reliable than
// scraping avatar URLs and lets us act on the *whole* row (message, member entry,
// DM) rather than just the avatar image.
// ---------------------------------------------------------------------------

// A sheet key of the form `user:<id>` targets everything belonging to one user.
export const USER_TARGET_RE = /^user:(\d{5,25})$/;

// Return the id from a `user:<id>` sheet key, or null if the key isn't one.
export function parseUserTarget(key: string): string | null {
	const m = USER_TARGET_RE.exec(key);
	return m ? m[1] : null;
}

// Discord avatar URLs carry the user id as a path segment, e.g.
//   https://cdn.discordapp.com/avatars/240617625594494977/abc.webp
//   https://cdn.discordapp.com/guilds/<g>/users/<id>/avatars/<h>.webp
const URL_ID_RE = /(?:avatars|users)\/(\d{5,25})(?:\/|$)/;

function idFromUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const m = URL_ID_RE.exec(value);
	return m ? m[1] : null;
}

// Given a React element's props, return the id of the user the element "belongs
// to" if that id is in `blocked` — otherwise null. Checks the handful of prop
// shapes Discord uses for message rows, member/list rows, autocomplete options
// and DM rows, then falls back to the avatar URL. Written to bail cheaply: this
// runs for every element created while user targets are active, and the common
// case (element owned by nobody blocked) must stay fast.
export function findBlockedUserId(props: any, blocked: Set<string>): string | null {
	if (!props || blocked.size === 0) return null;

	// Direct id-bearing shapes, most-specific first.
	const direct = [
		props.message?.author?.id, // message rows
		props.author?.id,
		props.user?.id, // member list, autocomplete, profiles
		props.userId,
		props.user?.userId,
		props.recipient?.id, // DM rows
		props.recipientId,
	];
	for (const id of direct) {
		if (typeof id === "string" && blocked.has(id)) return id;
	}

	// DM channels expose recipients as either ids or user objects.
	const recipients = props.channel?.recipients;
	if (Array.isArray(recipients)) {
		for (const r of recipients) {
			const id = typeof r === "string" ? r : r?.id;
			if (typeof id === "string" && blocked.has(id)) return id;
		}
	}

	// Avatar-URL fallback — the direct parallel to `[src*='<id>']`.
	const url =
		idFromUrl(props.source?.uri) ??
		idFromUrl(props.source) ??
		idFromUrl(props.src) ??
		idFromUrl(props.avatarURL) ??
		idFromUrl(props.avatar) ??
		idFromUrl(props.uri);
	if (url && blocked.has(url)) return url;

	return null;
}
