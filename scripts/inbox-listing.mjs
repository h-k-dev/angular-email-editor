/**
 * Writes the demo inbox's listing — `projects/app/public/examples/inbox.json`
 * — from the example catalogue: Gmail's split, a light list of headers the
 * inbox shows at once, and a file per message the reader fetches only when
 * its path (`/inbox/:id`) is opened. The headers are read out of the files
 * themselves, never written by hand: a reply example's own fields (all but
 * its body), a newsletter's name and `<title>`.
 *
 *   node scripts/inbox-listing.mjs          write it
 *   node scripts/inbox-listing.mjs --check  fail where it is not what the
 *                                           catalogue makes (CI)
 *
 * Run it after adding an example to the catalogue's `reply` or `mjml` set.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve('projects/app/public/examples');
const out = join(dir, 'inbox.json');

/** The catalogue's sets the inbox holds, in its order: the inbound
    messages first, then the newsletters. */
const INBOX_SETS = ['reply', 'mjml'];

/** "Jane Doe <jane@x>" → "Jane Doe"; a bare address stays as it is. */
const displayName = (from) => from.replace(/\s*<[^>]*>\s*$/, '').trim() || from;

/** A catalogue name without its provenance: "Worldly (compiled MJML)" → "Worldly". */
const shortName = (entry) => entry.name.replace(/\s*\([^)]*\)\s*$/, '');

/** The file's base name: `mjml/worldly.html` → `worldly`. */
const slug = (entry) => entry.file.replace(/^.*\//, '').replace(/\.[^.]+$/, '');

/** A reply example's header: the inbound message without its body — its
    subject what the catalogue calls it, where it has none. */
function fromReply(set, entry, text) {
  const { html, text: plain, ...head } = JSON.parse(text);
  const from = head.from ?? '';
  return {
    id: `${set.key}-${slug(entry)}`,
    file: entry.file,
    kind: 'reply',
    name: displayName(from) || entry.name,
    ...head,
    from,
    subject: head.subject ?? entry.name,
  };
}

/** A newsletter's header: from the sender its name says, its subject the
    document's title where it has one. It carries no date. */
function fromDocument(set, entry, html) {
  const name = shortName(entry);
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  return {
    id: `${set.key}-${slug(entry)}`,
    file: entry.file,
    kind: 'html',
    name,
    from: `${name} <${slug(entry)}@example.com>`,
    subject: title || name,
  };
}

const { sets } = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const mails = sets
  .filter((set) => INBOX_SETS.includes(set.key))
  .sort((a, b) => INBOX_SETS.indexOf(a.key) - INBOX_SETS.indexOf(b.key))
  .flatMap((set) =>
    set.examples.map((entry) => {
      const text = readFileSync(join(dir, entry.file), 'utf8');
      return set.kind === 'reply' ? fromReply(set, entry, text) : fromDocument(set, entry, text);
    }),
  );
const listing = JSON.stringify({ mails }, null, 2) + '\n';

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(out, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // Not written yet: as stale as a wrong one.
  }
  if (current !== listing) {
    console.log('inbox.json is not what the catalogue makes — run: node scripts/inbox-listing.mjs');
    process.exit(1);
  }
  console.log(`ok    inbox.json (${mails.length} mails)`);
} else {
  writeFileSync(out, listing);
  console.log(`wrote inbox.json (${mails.length} mails)`);
}
