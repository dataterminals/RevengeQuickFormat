# Surface bindings

Captured live from a running Kettu-patched Discord **342.16** on 2026-08-29,
by patching the `jsx`/`jsxs` runtime and recording component names and prop keys
while navigating. Reproduce with the harness in
[`AndroidClaudeBridge`](https://github.com/dataterminals/AndroidClaudeBridge)
(`abridge eval -f <probe>.js`).

This replaces guesswork. Each surface below says what actually renders it, which
prop carries the user id, and — importantly — why the earlier approach failed.

## Direct-message list

```
FastList
  └─ _FastListItemRenderer   { section, item, recyclerKey, fastListInstance, … }
       └─ TransitionItem     { item, renderItem }
            └─ MessagesItemChannelContent
                 { channel, channelSelected, favorite, muted, ignored,
                   blocked, hasActivity, hasUnreadMessages,
                   resolvedUnreadSetting, hasNameplate }
            └─ MessagesItemChannelAvatar
                 { channel, channelSelected, hasUnreadMessages, muted,
                   ignored, blocked, isStreaming, status }
```

**Why filtering never removed the row.** `FastList` has no data array. Its
contract is:

```
sections   : number[]        // row COUNT per section, e.g. [1,1,0,2,0,7,…]
sectionSize: (s) => number
itemSize   : (s, r) => number
renderItem : ({ section, row }) => element
getRecyclerKey, getAnchorIdFromIndex, getAnchorIndexFromId, …
```

Rows are addressed by `(section, row)` index, and the channel is resolved
*inside* `renderItem`. So filtering `PrivateChannelSortStore.getPrivateChannelIds()`
or hunting for a filterable array prop was always going to leave the cell in
place — the count is what decides how many cells exist.

**What would actually work:** patch the DM `FastList`'s props to (a) decrement
the affected `sections` count and (b) wrap `renderItem` so incoming row indices
are remapped past hidden entries. Both must change together or the list renders
the wrong channel in each slot.

The user id is not on the row directly — `channel.recipients` holds id strings,
and a DM is `channel.type === 1`.

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
