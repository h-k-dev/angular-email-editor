/**
 * Imports every built entry point of both packages under native ES module
 * semantics, the way a browser, Node or a Vite/vitest consumer loads the
 * fesm bundles.
 *
 * The library's own specs can't catch a module that reads a `const` before
 * its declaration at load time (a TDZ read): the unit-test builder bundles
 * with esbuild, which rewrites top-level `const` to `var`, so the read yields
 * `undefined` instead of throwing. Native ESM throws, and the whole entry —
 * and every entry that imports it — fails to load (issue #2: `BUTTON_FILL`).
 *
 * Dawn (@h-k-dev/dawn) is held to more: it is what a server imports to
 * draw an email, so its bundle may import nothing at all — no Angular, no
 * ProseMirror. And the editor imports it as an installed package, so the
 * workspace's build is linked into node_modules first, as npm puts it there.
 *
 *   node scripts/load-entries.mjs [fesm2022 dir …]
 *
 * Run it after `npm run build:lib`.
 */
import '@angular/compiler';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DAWN = resolve('dist/dawn');
const dirs = process.argv.length > 2
  ? process.argv.slice(2).map((dir) => resolve(dir))
  : [join(DAWN, 'fesm2022'), resolve('dist/angular-email-editor/fesm2022')];

// The editor's dependency, where an install would put it.
const link = resolve('node_modules/@h-k-dev/dawn');
if (existsSync(DAWN) && !lstatSync(link, { throwIfNoEntry: false })) {
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(DAWN, link, 'junction');
}

let failed = 0;
for (const dir of dirs) {
  const entries = readdirSync(dir).filter((file) => file.endsWith('.mjs'));
  if (!entries.length) throw new Error(`no .mjs entries in ${dir} — build the packages first`);
  for (const file of entries) {
    const path = join(dir, file);
    if (dir.startsWith(DAWN)) {
      const imports = readFileSync(path, 'utf8').match(/^(?:import|export)\b[^;]*\bfrom\s*['"][^'"]+['"]/gm);
      if (imports) {
        failed++;
        console.log(`FAIL  ${file}: Dawn must import nothing — ${imports.join(' · ')}`);
        continue;
      }
    }
    try {
      await import(pathToFileURL(path).href);
      console.log(`ok    ${file}`);
    } catch (error) {
      failed++;
      console.log(`FAIL  ${file}: ${error.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
