import { React } from "@vendetta/metro/common";
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
// user id -> style to inject onto anything belonging to that user
let userOverrides = new Map<string, StyleObject>();
// key set of userOverrides, for a cheap size check in the hot path
let blockedIds = new Set<string>();
// installed element-creation patches
let patches: Unpatch[] = [];

// Runtime counters for the DM-list hide, surfaced in the diagnostics report so
// we can see whether the filters actually run and match on-device (-1 = not run).
export const hideStats = {
	channelStoreOk: false,
	dmSortedPatched: false,
	dmIdsPatched: false,
	dmSortedIn: -1,
	dmSortedOut: -1,
	dmIdsIn: -1,
	dmIdsOut: -1,
	dmIdsResolved: -1,
	dmRowHidden: 0,
	dmDataFiltered: 0,
	channelEl: null as string | null,
	listEl: null as string | null,
	userEls: [] as string[],
};

// A stable component that renders nothing. Only ever swapped in for elements
// that are keyed (DM-list rows keyed by channel id), where the swap is constant
// per key and so can't change a component's hook count across renders.
const HIDDEN = () => null;

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

export interface ApplyResult {
	applied: string[];
	skipped: string[];
	failed: { key: string; reason: string }[];
}

// Merge styles into a props object, appending last so they win on conflict.
function mergeStyle(props: any, styles: StyleObject[]): any {
	const base = props ?? {};
	return { ...base, style: [base.style, ...styles] };
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

		// Diagnostic: record the first element that carries a DM/group-channel
		// object, so we can see what component renders a DM-list row and how.
		if (!hideStats.channelEl && props?.channel?.recipients) {
			try {
				const t: any = type;
				const name = t?.displayName || t?.name || (typeof t === "string" ? t : typeof t);
				hideStats.channelEl = `type=${name} keys=[${Object.keys(props).slice(0, 16).join(",")}] ch.type=${props.channel.type} recip=${JSON.stringify(props.channel.recipients)?.slice(0, 50)}`;
			} catch {
				/* ignore */
			}
		}

		// Diagnostic: record a few distinct user-bearing element shapes, to locate
		// the member-list row (populated once a server member list is open).
		if ((props?.user?.id || props?.member) && hideStats.userEls.length < 16) {
			try {
				const t: any = type;
				const name = t?.displayName || t?.name || (typeof t === "string" ? t : typeof t);
				if (!hideStats.userEls.some((s) => s.startsWith(`type=${name} `))) {
					const uid = props.user?.id ?? props.member?.userId ?? props.member?.user?.id ?? "?";
					hideStats.userEls.push(`type=${name} keys=[${Object.keys(props).slice(0, 12).join(",")}] uid=${uid}`);
				}
			} catch {
				/* ignore */
			}
		}

		if (blockedIds.size) {
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
					if (!hideStats.listEl) {
						const tt: any = type;
						hideStats.listEl = `type=${tt?.displayName || tt?.name || typeof tt} prop=${k} len=${v.length} item0=${typeof v[0] === "string" ? "id" : "obj"} keys=[${Object.keys(props).slice(0, 16).join(",")}]`;
					}
					const filtered = v.filter((item: any) => !isBlockedDMChannel(resolveChannel(item)));
					if (filtered.length !== v.length) {
						hideStats.dmDataFiltered += v.length - filtered.length;
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
				hideStats.dmRowHidden++;
				const next = args.slice();
				next[0] = HIDDEN;
				return next;
			}

			// User targets: an element that belongs to a targeted user.
			const uid = findBlockedUserId(props, blockedIds);
			if (uid) {
				const next = args.slice();
				next[1] = mergeStyle(props, [userOverrides.get(uid)!]);
				return next;
			}
		}

		// Element targets: a component we style wholesale.
		const styles = componentOverrides.get(type);
		if (styles) {
			const next = args.slice();
			next[1] = mergeStyle(props, styles);
			return next;
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
			hideStats.channelStoreOk = typeof ChannelStore?.getChannel === "function";
			const isBlockedDM = (c: any): boolean =>
				c?.type === 1 &&
				Array.isArray(c.recipients) &&
				c.recipients.some((r: any) => blockedIds.has(typeof r === "string" ? r : r?.id));

			if (typeof sortedStore?.getSortedPrivateChannels === "function") {
				hideStats.dmSortedPatched = true;
				patches.push(
					instead("getSortedPrivateChannels", sortedStore, function (this: unknown, args: any[], orig: any) {
						const list = orig.apply(this, args);
						try {
							if (!Array.isArray(list)) return list;
							const filtered = list.filter((c) => !isBlockedDM(c));
							hideStats.dmSortedIn = list.length;
							hideStats.dmSortedOut = filtered.length;
							return filtered.length === list.length ? list : filtered;
						} catch {
							return list;
						}
					}),
				);
			}

			if (typeof idsStore?.getPrivateChannelIds === "function") {
				hideStats.dmIdsPatched = true;
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
							hideStats.dmIdsIn = ids.length;
							hideStats.dmIdsOut = filtered.length;
							hideStats.dmIdsResolved = resolved;
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
	userOverrides = new Map();
	blockedIds = new Set();
	uninstall();
}

// Apply a parsed sheet. Safe to call repeatedly.
export function applySheet(sheet: Sheet): ApplyResult {
	componentOverrides = new Map();
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
			const component = target.resolve();
			if (!component) throw new Error(`component for "${key}" not found`);
			const arr = componentOverrides.get(component) ?? [];
			arr.push(style);
			componentOverrides.set(component, arr);
			result.applied.push(key);
		} catch (e) {
			result.failed.push({ key, reason: (e as Error).message });
		}
	}

	if (componentOverrides.size > 0 || userOverrides.size > 0) install();
	else uninstall();

	return result;
}
