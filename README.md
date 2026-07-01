# QuickFormat

A live, always-on **style-override editor** for Discord mobile, built as a
[Revenge](https://github.com/revenge-mod) plugin. It's the mobile answer to
Vencord/Vesktop's **QuickCSS**: a single place to drop appearance tweaks that
apply instantly, without authoring a whole theme or plugin.

> **Status:** early scaffold / MVP. The build pipeline, sheet editor, parser, and
> patching engine are in place. The set of styleable *targets* is small and
> marked experimental — see [Targets](#targets).

## Why this isn't literally "QuickCSS"

Vencord's QuickCSS works because desktop Discord runs in **Electron** — a real
Chromium browser. It injects a `<style>` tag full of CSS, and selectors like
`.message-2CShn3` can reach any element in the DOM.

Discord **mobile** is a completely different animal: it's a **React Native** app
compiled to Hermes bytecode. There is:

- no DOM,
- no CSS engine,
- no selectors.

Styling on React Native happens through `StyleSheet` objects and Discord's
semantic theme tokens. So a literal "paste CSS, it applies" feature is
impossible here. QuickFormat recreates the *spirit* of QuickCSS instead:

- a live, editable sheet you can open and tweak at any time,
- overrides that apply immediately when you save,
- a simple, forgiving authoring format.

The trade-off is that mobile has no selectors, so instead of targeting arbitrary
elements you target a curated registry of named UI pieces (see below).

## The sheet format

A QuickFormat **sheet** is a JSON object (comments and trailing commas allowed)
mapping a **target key** to a React Native **style object**:

```jsonc
{
  // Make chat message text bigger and bolder
  "messageText": { "fontSize": 17, "fontWeight": "600" },

  // Recolor the composer at the bottom of a channel
  "chatInput": { "backgroundColor": "#111318" }
}
```

Open the plugin's settings page to edit the sheet, see live validation, and
browse every available target key. Changes apply when you tap **Save & apply**.

Style keys and values are standard React Native style props — e.g. `color`,
`backgroundColor`, `fontSize`, `fontWeight`, `borderRadius`, `padding`,
`opacity`. Colors accept hex strings.

## Targets

Because there are no selectors, each styleable element is a hand-written
**target** in [`src/engine/targets.ts`](src/engine/targets.ts). A target knows
how to find one Discord component and merge your style into what it renders.

Targets are labelled:

- **stable** — reliable across app versions.
- **experimental** — depends on Discord-internal component names that can change
  between releases and needs on-device verification. If the component can't be
  found, the target quietly no-ops (it never crashes the app).

The current registry is intentionally small and experimental. Adding or fixing a
target is just appending to the array in `targets.ts`; contributions of verified
bindings are the main way this plugin grows.

## Building

Requires [Node.js](https://nodejs.org) 18+.

```sh
npm install
npm run build
```

This produces `dist/index.js` and `dist/manifest.json` (with an integrity
`hash`). Host the `dist/` folder anywhere static, then install the plugin in
Revenge from the URL to that folder.

`npm run typecheck` runs the TypeScript compiler without emitting.

## Project layout

```
manifest.json          Plugin manifest (name, description, entry, icon)
build.mjs              Rollup + esbuild bundler → dist/
src/
  index.ts            Entry point: onLoad / onUnload / settings
  controller.ts       reapply(): re-evaluate + re-apply the sheet
  storage.ts          Typed, persisted plugin state
  types.ts            Shared types (Sheet, Target, …)
  engine/
    parser.ts         JSONC-tolerant sheet parser + validation
    targets.ts        Registry of styleable targets (the selector replacement)
    apply.ts          Applies a parsed sheet; tracks/reverts patches
  components/
    Settings.tsx      Live sheet editor + validation + target browser
```

## Roadmap

- Grow and verify the target registry against a real device.
- Optional live-apply (debounced) instead of explicit save.
- A theme-token / color layer for app-wide recolors (reliable, selector-free).
- Import/export and shareable sheets.
- Syntax help and per-target style-key hints in the editor.

## License

[MIT](LICENSE).
