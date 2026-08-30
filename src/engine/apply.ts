import { React, ReactNative } from "@vendetta/metro/common";
import { findByName, findByProps, findByStoreName } from "@vendetta/metro";
import { before, instead } from "@vendetta/patcher";

import { getTarget } from "./targets";
import { findBlockedUserId, parseUserTarget } from "./match";
import type { Sheet, StyleObject, Unpatch } from "../types";

// ---------------------------------------------------------------------------
// Injection engine
//
// React 19 dropped forwardRef for many RN primitives, so Text/TextInput are now
// plain function components with no patchable `render`. Instead of patching each
// component, we patch React's element-creation path once (createElement plus the
// automatic `jsx`/`jsxs` runtime) and merge a style into elements as they're
// created.
//
// Two kinds of override are applied in that one hook:
//
//   • element targets — keyed by a component reference (e.g. RN.Text). Every
//     element of that exact component gets the style merged in. Because there's
//     a single React Native module instance, the reference we resolve is the
//     same one Discord renders with, so the match hits Discord's own elements.
//
//   • user targets — keyed by a Discord user id. An element that belongs to that
//     user (a message row, matched by the real author id, or an avatar image,
//     matched by its URL) gets the style merged in. A style of { display: "none" }
//     drops it from React Native's layout — the mobile stand-in for the desktop
//     `:has([src*='<id>']) { display: none }`, and because layout collapses there
//     is no leftover gap.
//
// We always *merge a style*, never replace the component. Swapping a hook-using
// component for a render-nothing one changes React's hook count at that tree
// position and throws "rendered fewer hooks than expected" — which froze the app
// after opening a hidden user's DM. Merging a style keeps the element mounted
// (its hooks/effects/subscriptions intact) and simply hides it.
//
// Messages get an extra, data-layer pass: style-hiding a message row leaves
// Discord's skeleton placeholder behind, so we also patch RowManager.generate to
// render a blocked author's row from an emptied clone (see install()). The two
// layers compose — the row generates as nothing and the style backstop collapses
// whatever remains.
// ---------------------------------------------------------------------------

// component reference -> styles to inject onto it
let componentOverrides = new Map<unknown, StyleObject[]>();
// predicate targets, for components that cannot be resolved by reference
let predicateOverrides: { match: (t: unknown, p: any) => boolean; styles: StyleObject[] }[] = [];
// user id -> style to inject onto anything belonging to that user
let userOverrides = new Map<string, StyleObject>();
// key set of userOverrides, for a cheap size check in the hot path
let blockedIds = new Set<string>();
// installed element-creation patches
let patches: Unpatch[] = [];

// Swapped in for a blocked user's list row. Renders a transparent overlay that
// claims tap touches (but yields to scrolling), so a leftover fixed-height cell
// stays blank AND can't be tapped to open the hidden user — a stopgap for cells
// the list won't collapse. Stable identity; only used for keyed rows, so the
// swap is constant per key and can't change any component's hook count.
const TOUCH_BLOCKER = (): any =>
	React.createElement(ReactNative.View as any, {
		style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
		onStartShouldSetResponder: () => true,
	});

// Read a component's render-time name, unwrapping the wrappers React puts
// between us and the function: memo() keeps it on `.type`, forwardRef() on
// `.render`, and the two nest.
//
// This is a third way to address a component, alongside a target's `resolve()`
// (by reference) and `match()` (by prop shape). Discord ships plenty of
// components that have a real name at render time but are never exported, so
// `findByName` cannot see them — `DMRow` below and `BaseIconImage` in
// targets.ts are both like this. The name on the type is the only handle we get.
function typeName(type: any): string | undefined {
	if (typeof type === "function") return type.name || undefined;
	if (type && typeof type === "object") {
		const inner = type.type ?? type.render;
		if (typeof inner === "function") return inner.name || undefined;
		if (inner && typeof inner === "object") return typeName(inner);
	}
	return undefined;
}

// ChannelStore reference (set during install) so the element hook can resolve a
// channel id to its channel object while filtering a list's data.
let channelStoreRef: any = null;

function isBlockedDMChannel(ch: any): boolean {
	return (
		ch?.type === 1 &&
		Array.isArray(ch.recipients) &&
		ch.recipients.some((r: any) => blockedIds.has(typeof r === "string" ? r : r?.id))
	);
}

function resolveChannel(item: any): any {
	if (typeof item === "string") return channelStoreRef?.getChannel?.(item);
	return item?.channel ?? item;
}

// Filter the DM list's `data` object, keeping `sections` and `dataKey` in step.
// Returns null when nothing was hidden, so the caller can leave props untouched.
//
// `sections` holds a row count per section; the section that lists DMs is the
// one whose count equals the channel-array length. That is matched by value
// rather than by a fixed index, because the section layout shifts with things
// like the favourites row and the friend-suggestion block being present or not.
function filterDMListData(data: any): any | null {
	const channels: any[] = data.channels;
	const keep = channels.filter(
		(c) => !isBlockedDMChannel(channelStoreRef?.getChannel?.(c?.channelId)),
	);
	const favs: any[] | null = Array.isArray(data.channelFavorites) ? data.channelFavorites : null;
	const favKeep = favs
		? favs.filter((c) => !isBlockedDMChannel(channelStoreRef?.getChannel?.(c?.channelId)))
		: null;

	const channelsChanged = keep.length !== channels.length;
	const favsChanged = !!favs && !!favKeep && favKeep.length !== favs.length;
	if (!channelsChanged && !favsChanged) return null;

	const next: any = { ...data };
	if (channelsChanged) next.channels = keep;
	if (favsChanged) next.channelFavorites = favKeep;

	if (Array.isArray(data.sections)) {
		const sections = data.sections.slice();
		// Retarget by original count, and never reuse a slot, so the channel and
		// favourite sections can't both land on the same index when their lengths
		// happen to coincide.
		const used = new Set<number>();
		const retarget = (from: number, to: number) => {
			if (from === to) return;
			const i = sections.findIndex((n: number, idx: number) => n === from && !used.has(idx));
			if (i !== -1) {
				used.add(i);
				sections[i] = to;
			}
		};
		if (channelsChanged) retarget(channels.length, keep.length);
		if (favsChanged) retarget(favs!.length, favKeep!.length);
		next.sections = sections;
	}

	// The list memoises its layout on dataKey; without a new one it reuses the
	// old cell count and the row reappears as an empty gap.
	next.dataKey = `${data.dataKey}-qf${keep.length}.${favKeep ? favKeep.length : 0}`;
	return next;
}

// Filter the member list's row set.
//
// The DM-search results list. `SearchList` takes a single flat `data` array
// that interleaves section headers with the rows under them:
//
//   { type: "section", props: { title: "Friends" } }
//   { type: "dm", section: "Friends", props: { user, nickname, onPress, type } }
//
// Every row names its own section by title, so unlike the member list there is
// no index arithmetic to keep in step — but a section header still has to be
// dropped once nothing is left under it, or it renders over the next section's
// rows. That is the "Friends header with no friends" symptom.
//
// Rows of other kinds (messages, media) carry a `section` too and are counted
// as occupants, so hiding a user never collapses a section they were not the
// only member of.
//
// Returns null when nothing was hidden, so the caller leaves props untouched.
function filterSearchListData(data: any[]): any[] | null {
	let hidden = 0;
	const kept = data.filter((entry: any) => {
		if (entry?.type !== "section" && blockedIds.has(entry?.props?.user?.id)) {
			hidden++;
			return false;
		}
		return true;
	});
	if (!hidden) return null;

	const populated = new Set<string>();
	for (const entry of kept) {
		if (entry?.type !== "section" && typeof entry?.section === "string") {
			populated.add(entry.section);
		}
	}
	return kept.filter(
		(entry: any) => entry?.type !== "section" || populated.has(entry?.props?.title),
	);
}

// ChannelMemberStore.getProps(guildId, channelId) returns
//   { listId, groups, rows, version }
// where `rows` is one flat array of GROUP headers and MEMBER entries, and
// `groups` describes each section as { id, title, count, index } — `count` being
// the members in it and `index` the position of its header inside `rows`.
//
// Dropping a member therefore means three edits, not one: remove the row,
// decrement its group's count, and re-index every group that sits after it.
// Miss the last of those and the sections point at the wrong rows.
//
// Returns null when nothing was hidden, so callers can pass the original through.
function filterMemberRows(rows: any[], groups: any[] | undefined) {
	const kept: any[] = [];
	const removedPerGroup = new Map<string, number>();
	let currentGroup: string | null = null;
	let removed = 0;

	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		if (r?.type === "GROUP") currentGroup = r.id;
		if (r?.type === "MEMBER" && blockedIds.has(r.userId)) {
			removed++;
			if (currentGroup) {
				removedPerGroup.set(currentGroup, (removedPerGroup.get(currentGroup) ?? 0) + 1);
			}
			continue;
		}
		kept.push(r);
	}
	if (!removed) return null;

	// Rebuild only the groups that actually changed, as fresh objects — the
	// originals belong to the store and must not be mutated.
	let nextGroups = groups;
	if (Array.isArray(groups)) {
		const newIndex = new Map<string, number>();
		for (let i = 0; i < kept.length; i++) {
			const r = kept[i];
			if (r?.type === "GROUP") newIndex.set(r.id, i);
		}
		const replaced = new Map<string, any>();
		nextGroups = groups.map((g: any) => {
			if (!g?.id) return g;
			const lost = removedPerGroup.get(g.id) ?? 0;
			const idx = newIndex.get(g.id);
			const countChanged = lost > 0 && typeof g.count === "number";
			const indexChanged = idx !== undefined && typeof g.index === "number" && idx !== g.index;
			if (!countChanged && !indexChanged) return g;
			const next = { ...g };
			if (countChanged) next.count = Math.max(0, g.count - lost);
			if (indexChanged) next.index = idx;
			replaced.set(g.id, next);
			return next;
		});
		// The same header objects appear inside `rows`; swap in the updated ones
		// so the two views of a group cannot disagree.
		if (replaced.size) {
			for (let i = 0; i < kept.length; i++) {
				const r = kept[i];
				if (r?.type === "GROUP" && replaced.has(r.id)) kept[i] = replaced.get(r.id);
			}
		}
	}

	return { rows: kept, groups: nextGroups, removed };
}

export interface ApplyResult {
	applied: string[];
	skipped: string[];
	failed: { key: string; reason: string }[];
}

// Merge styles into a props object, appending last so they win on conflict.
//
// Native host components (a string element type such as "RCTText") are the end
// of the line: React Native's JS wrappers normally flatten styles before handing
// them over, so a host given a nested array quietly ignores it. Flattening for
// those is what makes styling text work at all — Discord renders straight to
// RCTText rather than through RN's `Text`, so the host case is the common one,
// not the exotic one.
function mergeStyle(props: any, styles: StyleObject[], type?: unknown): any {
	const base = props ?? {};
	const merged = [base.style, ...styles];
	if (typeof type === "string") {
		const flatten = (ReactNative as any)?.StyleSheet?.flatten;
		if (typeof flatten === "function") return { ...base, style: flatten(merged) };
	}
	return { ...base, style: merged };
}

// A copy of a message row with everything renderable stripped out, so that
// RowManager.generate produces an empty row instead of a skeleton placeholder.
// We clone (never mutate the store's MessageRecord) and keep identity fields
// (id, author, type, timestamp) so generate still runs normally.
function blankMessageRow(row: any): any {
	return {
		...row,
		renderContentOnly: true,
		message: {
			...row.message,
			content: "",
			customRenderedContent: null,
			attachments: [],
			embeds: [],
			stickers: [],
			stickerItems: [],
			soundboardSounds: [],
			components: [],
			codedLinks: [],
		},
	};
}

// spitroast `before` hook: element-creation calls look like (type, props, ...).
// Returning a new args array replaces the arguments; returning nothing leaves
// them untouched. Wrapped so a matching error can never escape into a render.
function hook(args: any[]): any[] | undefined {
	if (!args?.length) return;
	try {
		const type = args[0];
		const props = args[1];

		if (blockedIds.size) {
			// "Happening Now" — the voice-activity carousel across the top of the
			// Messages screen. Plain array of { kind, userId, voiceState, guildId },
			// so a hidden user is simply dropped from it.
			if (Array.isArray(props?.data) && props.data.length) {
				const f = props.data[0];
				if (f && typeof f === "object" && "kind" in f && "userId" in f && "voiceState" in f) {
					const keep = props.data.filter((e: any) => !blockedIds.has(e?.userId));
					if (keep.length !== props.data.length) {
						const next = args.slice();
						next[1] = { ...props, data: keep };
						return next;
					}
				}
			}

			// DM-search results, at the data layer. This is the primary path: it
			// takes the row out of the array the list builds from, which also lets
			// us drop a section header once its last row is gone. The DMRow swap
			// below stays as a backstop for any DMRow rendered outside SearchList.
			if (typeName(type) === "SearchList" && Array.isArray(props?.data)) {
				const filtered = filterSearchListData(props.data);
				if (filtered) {
					const next = args.slice();
					next[1] = { ...props, data: filtered };
					return next;
				}
			}

			// Search / people results, and the "Suggested" list behind them. Both
			// render through `memo(DMRow)`, matched by its render-time name — the
			// component is never exported, so findByName("DMRow") returns null.
			//
			// This was previously gated on the props being exactly { user, onPress }.
			// That shape is real, but only on the Suggested list: an actual search
			// result arrives as { user, onPress, nickname, type }, so the arity check
			// never matched on the screen that mattered and the hide silently did
			// nothing. Measured on 342.16 — 342 renders across a results screen, all
			// carrying four props. Matching the name instead survives Discord adding
			// a fifth.
			//
			// Rows are keyed, so a constant-per-key swap can't shift any hook count.
			if (
				props?.user?.id &&
				blockedIds.has(props.user.id) &&
				typeName(type) === "DMRow"
			) {
				const next = args.slice();
				next[0] = TOUCH_BLOCKER;
				return next;
			}

			// The DM list itself. Its rows come from a single `data` object:
			//
			//   data = {
			//     channels:         [{ channelId, lastMessageId, isFavorite, isRequest }, …],
			//     channelFavorites: [ … ],
			//     sections:         number[],   // row COUNT per section
			//     dataKey:          string,     // memoisation key
			//   }
			//
			// Filtering `channels` on its own is not enough: `sections` decides how
			// many cells the list builds, and `dataKey` memoises the computed layout.
			// All three have to move together, or the removed row comes back as an
			// empty-but-tappable cell — which is exactly what the earlier
			// store-filtering attempts produced.
			//
			// Entries carry only a channelId, so the channel is resolved through
			// ChannelStore to test its recipients.
			if (Array.isArray(props?.data?.channels) && "listItemHeight" in props) {
				const filtered = filterDMListData(props.data);
				if (filtered) {
					const next = args.slice();
					next[1] = { ...props, data: filtered };
					return next;
				}
			}

			// Remove blocked DMs from a channel array held in some prop of a list
			// element (drops them from the quick switcher and any array-fed list).
			// Gated to list elements (renderItem/getItemKey) to stay off the hot
			// path. Note: the DM sidebar itself is an animated TransitionGroup whose
			// removed rows linger for the exit animation, so this can't fully clear
			// its cell — that's a known limitation. Filters a copy onto a fresh
			// props object; only acts when a blocked DM is actually present.
			if (
				props &&
				(typeof (props as any).renderItem === "function" ||
					typeof (props as any).getItemKey === "function")
			) {
				let nextProps: any = null;
				for (const k of Object.keys(props)) {
					const v = (props as any)[k];
					if (!Array.isArray(v) || v.length === 0) continue;
					const t0 = resolveChannel(v[0])?.type;
					if (t0 !== 1 && t0 !== 3) continue;
					const filtered = v.filter((item: any) => !isBlockedDMChannel(resolveChannel(item)));
					if (filtered.length !== v.length) {
						nextProps = nextProps ?? { ...props };
						nextProps[k] = filtered;
					}
				}
				if (nextProps) {
					const next = args.slice();
					next[1] = nextProps;
					return next;
				}
			}

			// DM-list row backstop — keyed by channel id, so replacing it with a
			// render-nothing component is safe (constant per key). Gated on the
			// row-only channelSelected/hasUnreadMessages props so we never touch the
			// DM *screen* header/input, whose hook count would flip on navigation.
			const ch = props?.channel;
			if (ch && "channelSelected" in props && "hasUnreadMessages" in props && isBlockedDMChannel(ch)) {
				const next = args.slice();
				next[0] = TOUCH_BLOCKER;
				return next;
			}

			// User targets: an element that belongs to a targeted user.
			const uid = findBlockedUserId(props, blockedIds);
			if (uid) {
				const next = args.slice();
				next[1] = mergeStyle(props, [userOverrides.get(uid)!], type);
				return next;
			}
		}

		// Element targets: a component we style wholesale.
		const styles = componentOverrides.get(type);
		if (styles) {
			const next = args.slice();
			next[1] = mergeStyle(props, styles, type);
			return next;
		}

		// Predicate targets, for components with no resolvable reference. Checked
		// last, and only when some target actually uses one, so the usual path
		// stays a single Map lookup.
		if (predicateOverrides.length) {
			let matched: StyleObject[] | null = null;
			for (const p of predicateOverrides) {
				if (p.match(type, props)) (matched ??= []).push(...p.styles);
			}
			if (matched) {
				const next = args.slice();
				next[1] = mergeStyle(props, matched, type);
				return next;
			}
		}
	} catch {
		// Never let a matching error break Discord's render.
	}
	return;
}

function install(): void {
	if (patches.length) return;
	const add = (fn: string, parent: any) => {
		if (parent && typeof parent[fn] === "function") {
			patches.push(before(fn, parent, hook));
		}
	};
	// Classic runtime.
	add("createElement", React);
	// Automatic runtime (react/jsx-runtime) and its dev variant.
	add("jsx", findByProps("jsx", "jsxs"));
	add("jsxs", findByProps("jsx", "jsxs"));
	add("jsxDEV", findByProps("jsxDEV"));

	// Data-layer message hide. When a message row belongs to a blocked user, run
	// RowManager.generate on an emptied clone so the row renders as nothing rather
	// than leaving a skeleton placeholder behind. Guarded end to end: on any error
	// we fall back to the original call, so the worst case is "doesn't hide".
	if (blockedIds.size) {
		try {
			const RowManager: any = findByName("RowManager");
			const proto = RowManager?.prototype;
			if (typeof proto?.generate === "function") {
				patches.push(
					instead("generate", proto, function (this: unknown, args: any[], orig: any) {
						try {
							const row = args?.[0];
							const id = row?.rowType === 1 ? row.message?.author?.id : undefined;
							if (id && blockedIds.has(id)) {
								return orig.call(this, blankMessageRow(row));
							}
						} catch {
							/* fall through to the original */
						}
						return orig.apply(this, args);
					}),
				);
			}
		} catch (e) {
			console.warn("[QuickFormat] RowManager hide unavailable:", e);
		}
	}

	// Data-layer DM-list hide. The DM sidebar renders from
	// PrivateChannelSortStore.getPrivateChannelIds() (a list of channel ids), so
	// that's the getter we must filter to drop the row; we also filter
	// getSortedPrivateChannels() (channel objects), which feeds search and the
	// quick switcher. Each returns a filtered *copy* (never mutating the store's
	// array) and returns the original array untouched when nothing matched. A
	// blocked DM is a 1:1 DM (type 1) whose recipient is blocked.
	if (blockedIds.size) {
		try {
			// Resolve the sort store precisely by name (PrivateChannelSortStore
			// carries both getters); fall back to per-method findByProps. The DM
			// list subscribes to this store, so its getters are what we must filter.
			const sortStore: any = findByStoreName("PrivateChannelSortStore");
			const sortedStore: any =
				typeof sortStore?.getSortedPrivateChannels === "function"
					? sortStore
					: findByProps("getSortedPrivateChannels");
			const idsStore: any =
				typeof sortStore?.getPrivateChannelIds === "function"
					? sortStore
					: findByProps("getPrivateChannelIds");
			const ChannelStore: any =
				findByStoreName("ChannelStore") ??
				findByProps("getChannel", "getDMFromUserId") ??
				findByProps("getChannel", "hasChannel");
			channelStoreRef = ChannelStore;
			const isBlockedDM = (c: any): boolean =>
				c?.type === 1 &&
				Array.isArray(c.recipients) &&
				c.recipients.some((r: any) => blockedIds.has(typeof r === "string" ? r : r?.id));

			if (typeof sortedStore?.getSortedPrivateChannels === "function") {
				patches.push(
					instead("getSortedPrivateChannels", sortedStore, function (this: unknown, args: any[], orig: any) {
						const list = orig.apply(this, args);
						try {
							if (!Array.isArray(list)) return list;
							const filtered = list.filter((c) => !isBlockedDM(c));
							return filtered.length === list.length ? list : filtered;
						} catch {
							return list;
						}
					}),
				);
			}

			if (typeof idsStore?.getPrivateChannelIds === "function") {
				patches.push(
					instead("getPrivateChannelIds", idsStore, function (this: unknown, args: any[], orig: any) {
						const ids = orig.apply(this, args);
						try {
							if (!Array.isArray(ids)) return ids;
							let resolved = 0;
							const filtered = ids.filter((id: string) => {
								const ch = ChannelStore?.getChannel?.(id);
								if (ch) resolved++;
								return !isBlockedDM(ch);
							});
							return filtered.length === ids.length ? ids : filtered;
						} catch {
							return ids;
						}
					}),
				);
			}
		} catch (e) {
			console.warn("[QuickFormat] DM-list hide unavailable:", e);
		}
	}

	// Member list, at the data layer. Rows come from
	// ChannelMemberStore.getRows(guildId, channelId) as one flat array of
	// { type: "GROUP" | "MEMBER", … }, where MEMBER rows carry `userId` and GROUP
	// rows are section headers (no counts on them, so removing a member needs no
	// bookkeeping elsewhere).
	//
	// This is the only place a member row can actually be *removed*. The list
	// itself is a native component (`FastestList`) fed `sectionsVersioned`, which
	// carries just per-section counts and sizes with uniform empty item keys —
	// no identities cross into JS, so there is nothing to filter downstream and
	// an element-level swap can only leave a blank 56px cell behind.
	//
	// `MemberListStore` does not exist on this build; `ChannelMemberStore` is its
	// replacement, which is why the earlier lookup came back null.
	if (blockedIds.size) {
		try {
			const ChannelMemberStore: any = findByStoreName("ChannelMemberStore");

			// The list reads getProps (getRows is a secondary accessor), so both are
			// patched — getProps is the one that actually changes what renders.
			//
			// Both are called on render over a row array that runs to tens of
			// thousands of entries in a large guild, so results are memoised against
			// the object the store handed us. That also keeps the returned identity
			// stable; a fresh object every call would re-render the list forever.
			if (typeof ChannelMemberStore?.getProps === "function") {
				const propsCache = new WeakMap<object, any>();
				patches.push(
					instead("getProps", ChannelMemberStore, function (this: unknown, args: any[], orig: any) {
						const props = orig.apply(this, args);
						try {
							if (!props || !Array.isArray(props.rows)) return props;
							const cached = propsCache.get(props);
							if (cached) return cached;

							const next = filterMemberRows(props.rows, props.groups);
							if (!next) {
								propsCache.set(props, props);
								return props;
							}
							const out = { ...props, rows: next.rows, groups: next.groups };
							propsCache.set(props, out);
							return out;
						} catch {
							return props;
						}
					}),
				);
			}

			if (typeof ChannelMemberStore?.getRows === "function") {
				const rowsCache = new WeakMap<object, any[]>();
				patches.push(
					instead("getRows", ChannelMemberStore, function (this: unknown, args: any[], orig: any) {
						const rows = orig.apply(this, args);
						try {
							if (!Array.isArray(rows)) return rows;
							const cached = rowsCache.get(rows);
							if (cached) return cached;
							const next = filterMemberRows(rows, undefined);
							const out = next ? next.rows : rows;
							rowsCache.set(rows, out);
							return out;
						} catch {
							return rows;
						}
					}),
				);
			}
		} catch (e) {
			console.warn("[QuickFormat] member-list hide unavailable:", e);
		}
	}

}

function uninstall(): void {
	for (const undo of patches.splice(0)) {
		try {
			undo();
		} catch (e) {
			console.warn("[QuickFormat] failed to remove a patch:", e);
		}
	}
}

// Revert every applied override.
export function clear(): void {
	componentOverrides = new Map();
	predicateOverrides = [];
	userOverrides = new Map();
	blockedIds = new Set();
	uninstall();
}

// Apply a parsed sheet. Safe to call repeatedly.
export function applySheet(sheet: Sheet): ApplyResult {
	componentOverrides = new Map();
	predicateOverrides = [];
	userOverrides = new Map();
	blockedIds = new Set();
	const result: ApplyResult = { applied: [], skipped: [], failed: [] };

	for (const [key, style] of Object.entries(sheet)) {
		// user:<id> target — no component to resolve, so it always "applies".
		const userId = parseUserTarget(key);
		if (userId) {
			userOverrides.set(userId, style);
			blockedIds.add(userId);
			result.applied.push(key);
			continue;
		}

		const target = getTarget(key);
		if (!target) {
			result.skipped.push(key);
			continue;
		}
		try {
			// A target may name several references — a native host component and
			// the JS wrapper over it, say — since which one an app actually renders
			// varies. Every one that resolves gets the style.
			const resolved = target.resolve?.();
			const components = (Array.isArray(resolved) ? resolved : [resolved]).filter(
				(c) => c != null,
			);
			if (!components.length && !target.match) {
				throw new Error(`component for "${key}" not found`);
			}
			for (const component of components) {
				const arr = componentOverrides.get(component) ?? [];
				arr.push(style);
				componentOverrides.set(component, arr);
			}
			if (target.match) {
				predicateOverrides.push({ match: target.match.bind(target), styles: [style] });
			}
			result.applied.push(key);
		} catch (e) {
			result.failed.push({ key, reason: (e as Error).message });
		}
	}

	// Predicate targets count too. A sheet made up only of `match` targets
	// registers its predicates and then, without this, uninstalls the very
	// patches that would consult them — so it silently does nothing. Latent
	// until the first target with a `match` and no `resolve`.
	if (
		componentOverrides.size > 0 ||
		predicateOverrides.length > 0 ||
		userOverrides.size > 0
	) {
		install();
	} else {
		uninstall();
	}

	return result;
}
