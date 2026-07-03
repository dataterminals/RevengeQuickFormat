// ---------------------------------------------------------------------------
// User matching — the mobile stand-in for the desktop CSS `[src*='<id>']`.
//
// On the web, QuickCSS hides a user by matching their avatar URL and walking up
// with `:has(...)`. React Native has no selectors and no DOM to walk, but it
// does hand us the real component props at element-creation time. We match on
// the *row-level* id only (the message's author) plus the avatar URL — NOT every
// place a user id appears. Generic `user.id` / `userId` props show up on profile
// popouts, channel headers, the message input and dozens of other components;
// matching those hides (and, worse, tears out) whole screens — e.g. a blocked
// user's DM view — so they are intentionally excluded.
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

// A React Native image `source` can be a string, an { uri } object, or an array
// of either. Dig an id out of any of those shapes.
function idFromSource(source: unknown): string | null {
	if (Array.isArray(source)) {
		for (const s of source) {
			const id = idFromSource(s);
			if (id) return id;
		}
		return null;
	}
	if (source && typeof source === "object") return idFromUrl((source as { uri?: unknown }).uri);
	return idFromUrl(source);
}

// Given a React element's props, return the id of the user the element "belongs
// to" if that id is in `blocked` — otherwise null. Deliberately narrow: only a
// message row (which carries the whole message, so hiding it takes the avatar
// and content with it) or an avatar image. Runs for every element created while
// user targets are active, so it bails as cheaply as possible.
export function findBlockedUserId(props: any, blocked: Set<string>): string | null {
	if (!props || blocked.size === 0) return null;

	// Message row: the author id here identifies the whole row.
	const authorId = props.message?.author?.id ?? props.author?.id;
	if (typeof authorId === "string" && blocked.has(authorId)) return authorId;

	// Avatar image: the user id is a path segment in the URL — the direct
	// parallel to `[src*='<id>']`. Catches stray avatars (member list, reactions)
	// even where we don't yet match the whole surrounding row.
	const url =
		idFromSource(props.source) ??
		idFromUrl(props.src) ??
		idFromUrl(props.avatarURL) ??
		idFromUrl(props.avatar) ??
		idFromUrl(props.uri);
	if (url && blocked.has(url)) return url;

	return null;
}
