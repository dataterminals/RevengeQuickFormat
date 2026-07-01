// Build script for the QuickFormat Revenge/Vendetta plugin.
//
// It bundles src/<manifest.main> into a single IIFE, keeping every `@vendetta/*`
// import as a reference to the global `vendetta` object that Revenge injects at
// runtime (e.g. `@vendetta/metro/common` -> `vendetta.metro.common`). It then
// writes dist/index.js alongside a dist/manifest.json that carries a sha256
// integrity hash — the shape Revenge's plugin loader expects when you install
// the plugin from a URL.
//
// Approach adapted from the widely-used vendetta plugin build (redstonekasi/beef).

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import esbuild from "rollup-plugin-esbuild";

const manifest = JSON.parse(await readFile("./manifest.json", "utf-8"));
const outDir = "./dist";
const outPath = `${outDir}/index.js`;

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

try {
	const bundle = await rollup({
		input: manifest.main,
		onwarn: () => {},
		plugins: [
			nodeResolve(),
			commonjs(),
			esbuild({ target: "esnext", minify: true }),
		],
	});

	await bundle.write({
		file: outPath,
		// Unresolved imports (@vendetta/*, react) are treated as external by
		// rollup; map them to the globals Revenge exposes at runtime.
		globals(id) {
			if (id.startsWith("@vendetta")) return id.substring(1).replace(/\//g, ".");
			return { react: "window.React" }[id] || null;
		},
		format: "iife",
		compact: true,
		exports: "named",
	});
	await bundle.close();

	const hash = createHash("sha256")
		.update(await readFile(outPath))
		.digest("hex");

	await writeFile(
		`${outDir}/manifest.json`,
		JSON.stringify({ ...manifest, main: "index.js", hash }),
	);

	console.log(`✔ Built ${manifest.name} → ${outDir}/ (hash ${hash.slice(0, 12)}…)`);
} catch (err) {
	console.error("✖ Failed to build QuickFormat:", err);
	process.exit(1);
}
