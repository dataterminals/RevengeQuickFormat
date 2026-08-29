# Surface bindings

Captured live from a running Kettu-patched Discord **342.16** on 2026-08-29,
by patching the `jsx`/`jsxs` runtime and recording component names and prop keys
while navigating. Reproduce with the harness in
[`AndroidClaudeBridge`](https://github.com/dataterminals/AndroidClaudeBridge)
(`abridge eval -f <probe>.js`).

This replaces guesswork. Each surface below says what actually renders it, which
prop carries the user id, and — importantly — why the earlier approach failed.

## Direct-message list

The list is a `React.memo` component with **no displayName**, identified by
`listItemHeight` in its props. Everything it renders comes from one `data` object:

```
data = {
  channels:         [{ channelId, lastMessageId, isFavorite, isRequest }, …],
  channelFavorites: [ … same shape … ],
  sections:         number[],   // row COUNT per section, e.g. [1, 6, 0, 0, 0]
  dataKey:          string,     // memoisation key, e.g. "20"
  friendSuggestions, showFullscreenEmptyState, renderHeader, renderFooter,
}
```

Rows render through `AnimatedEnterExitItem { item, entering, exiting, renderItem }`
into `MessagesItemChannelContent { channel, channelSelected, favorite, muted,
ignored, blocked, hasActivity, hasUnreadMessages, resolvedUnreadSetting,
hasNameplate }`.

**Why the earlier attempts failed.** Two independent reasons:

1. `PrivateChannelSortStore.getPrivateChannelIds()` is not what this list reads.
   Filtering it changed nothing, which matches the 8→7 filter that the sidebar
   ignored.
2. The plugin's generic "filter any channel array on a list element" pass was
   gated on `renderItem`/`getItemKey` being in props. This component has
   **neither** — its rows come from `data` — so the element was never examined.

**What works** (implemented in `engine/apply.ts` as `filterDMListData`): filter
`data.channels` and `data.channelFavorites`, *and* fix up `data.sections`, *and*
change `data.dataKey`. All three must move together:

- `sections` holds the row **count** per section and is what decides how many
  cells exist — filtering the array alone leaves an empty, tappable cell, which
  is exactly the symptom reported before.
- `dataKey` memoises the computed layout; without a new value the list reuses the
  old cell count.

Entries carry only a `channelId`, so the channel is resolved via `ChannelStore`
to test `type === 1` and its `recipients`.

The DM section is located by **value** — the section whose count equals the
channel-array length — rather than a fixed index, because the section layout
shifts with the favourites row and friend-suggestion block.

Verified live on Discord 342.16: 6 DM rows → 5 with one user hidden, no gap and
no leftover tappable cell; back to 6 when the sheet is cleared. Note that
*removing* a hide needs an app restart before the row returns, because the list
memoises its layout — a plugin restart alone is not enough.

Note the `FastList` described below is the **guild channel list**, not this one.

### Guild channel list (a different list)

`FastList { sections: number[], sectionSize, itemSize, renderItem({section,row}),
getRecyclerKey, getAnchorIdFromIndex, … }` — addressed by `(section, row)` with
no data array at all. Its `renderItem` returns a plain `View` wrapper.

## Member list

```
MembersScreen            { searchContext }
SearchableMembersScreen  { searchContext, guildId }
  └─ GuildChannelUserList { onUserPress, onUserLongPress, channelId, guildId,
                            disableStickySections, listStyleOverride,
                            isNameplatedList, canShowDisplayNameStylesFont }
       └─ host:FastestList { sectionsVersioned, renderAhead,
                             onVisibleItemsChanged, placeholderConfig, … }
            └─ UserRow    { type, user, nickname, usernameColor, roleColors,
                            isNameplatedRow, premiumSince, isOwner, guildId,
                            canShowDisplayNameStylesFont, onPress, onLongPress,
                            start, end }
            └─ UserRowSubLabel { user, type, animate, isGameRelationship,
                                 guildId, applicationId }
```

**`findByStoreName("MemberListStore")` returned null because the list is not
driven by a JS store on this build.** The outer list is `host:FastestList` — a
**native** host component fed `sectionsVersioned`. There is no JS-side array to
filter, which is why both the store approach and the row-type approach came up
empty.

`UserRow` is the tractable seam: it receives `user` directly, so `props.user.id`
is the discriminator, and the row is a normal React element that can be styled
or replaced. Note the member list did **not** appear as a `RowManager` rowType —
that finding stands.

## Messages

Unchanged and still the most reliable binding: `RowManager.prototype.generate`,
message rows are `rowType === 1`, author at `row.message.author.id`. Rendering
nothing requires generating from an emptied clone; element-level
`display: none` alone leaves a skeleton placeholder.

## Recording your own captures

```js
// installs a jsx/jsxs recorder into globalThis.__rec
// then:  __rec.dump("member|user")   ->  { ComponentName: [propKeys…] }
```

See `AndroidClaudeBridge`'s CLAUDE.md. Two gotchas:

- Components already mounted will not re-render, so navigate **away and back**
  to force a fresh mount before dumping.
- Recycled rows in a virtualized list often do not pass through `jsx` again;
  a remount is more reliable than scrolling.
