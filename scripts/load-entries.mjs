/**
 * Imports every built entry point of the library under native ES module
 * semantics, the way a browser, Node or a Vite/vitest consumer loads the
 * fesm bundles.
 *
 * The library's own specs can't catch a module that reads a `const` before
 * its declaration at load time (a TDZ read): the unit-test builder bundles
 * with esbuild, which rewrites top-level `const` to `var`, so the read yields
 * `undefined` instead of throwing. Native ESM throws, and the whole entry —
 * and every entry that imports it — fails to load (issue #2: `BUTTON_FILL`).
 *
 *   node scripts/load-entries.mjs [dist/angular-email-editor/fesm2022]
 *
 * Run it after `ng build angular-email-editor`.
 */
import '@angular/compiler';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = resolve(process.argv[2] ?? 'dist/angular-email-editor/fesm2022');
const entries = readdirSync(dir).filter((file) => file.endsWith('.mjs'));
if (!entries.length) throw new Error(`no .mjs entries in ${dir} — build the library first`);

let failed = 0;
for (const file of entries) {
  try {
    await import(pathToFileURL(join(dir, file)).href);
    console.log(`ok    ${file}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${file}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
