/**
 * build-windows-portable.mjs
 *
 * Produces a portable, drag-and-drop Windows build at:
 *   dist/openscreen-portable-<version>/
 *
 * Usage (called by package.json "build:win:portable"):
 *   node scripts/build-windows-portable.mjs
 *
 * What it does:
 *   1. Runs electron-builder --win dir into a staging directory.
 *   2. Renames the resulting `win-unpacked/` sub-directory to the
 *      final portable folder name: dist/openscreen-portable-<version>/.
 *   3. Removes the staging wrapper so the end result is flat.
 *
 * The final directory layout the user sees:
 *   dist/openscreen-portable-1.10.0/
 *   ├── Openscreen.exe     ← double-click to run
 *   ├── resources/
 *   ├── locales/
 *   └── ...
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Read version from package.json (avoid importing it as JSON to stay ESM-clean)
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const portableName = `openscreen-portable-${version}`;
const stagingDir = path.join(repoRoot, "dist", ".portable-staging");
const finalDir = path.join(repoRoot, "dist", portableName);

// --- 1. Clean previous staging and final dirs ---
console.log(`[portable] Building ${portableName}…`);
for (const dir of [stagingDir, finalDir]) {
	if (existsSync(dir)) {
		console.log(`[portable] Removing existing ${path.relative(repoRoot, dir)}`);
		rmSync(dir, { recursive: true, force: true });
	}
}
mkdirSync(stagingDir, { recursive: true });

// --- 2. Run electron-builder (dir target) ---
// Pass --config.npmRebuild=false because the native addons are already
// compiled by the upstream build:native:* / fetch:* steps that precede us.
// The `directories.output` override points electron-builder at our staging
// dir so its hard-coded `win-unpacked` sub-directory lands where we expect it.
const cmd = [
	"npx electron-builder",
	"--win dir",
	`--config.directories.output=${JSON.stringify(stagingDir)}`,
	"--config.npmRebuild=false",
	"--publish never",
].join(" ");

console.log(`[portable] Running: ${cmd}`);
execSync(cmd, { stdio: "inherit", cwd: repoRoot });

// --- 3. Promote win-unpacked → final name ---
const unpackedDir = path.join(stagingDir, "win-unpacked");
if (!existsSync(unpackedDir)) {
	console.error(
		`[portable] ERROR: expected ${path.relative(repoRoot, unpackedDir)} — electron-builder may have changed its output layout`,
	);
	process.exit(1);
}

console.log(`[portable] Renaming ${path.relative(repoRoot, unpackedDir)} → dist/${portableName}`);
renameSync(unpackedDir, finalDir);

// --- 4. Remove the now-empty staging wrapper ---
rmSync(stagingDir, { recursive: true, force: true });

console.log(`\n[portable] Done. Portable build at:\n  dist/${portableName}/`);
console.log(`  Run: dist\\${portableName}\\Openscreen.exe`);
