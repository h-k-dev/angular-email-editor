/**
 * The Summernote corpus — what iusta-core-frontend's Summernote stores, one
 * file per thing its users do (`fixtures/summernote/`, written by
 * `scripts/summernote-corpus.mjs` from the real Summernote with core's
 * patches). Core runs both editors side by side on the same stored HTML, so
 * every template a user opens in ours must come back with the author's
 * intent intact.
 *
 * Intact is not "as Summernote wrote it". Summernote stores things that are
 * wrong in a mail client — a `mailto://` link, `http://` glued onto a
 * placeholder, a bordered table whose borders were Bootstrap CSS, Word's
 * `<o:p>` — and ours is there to correct them. So each file is judged twice:
 *
 * - **kept** — the text, the placeholders, the link targets, the images
 *   and the formatting each character carries, read off our output the way
 *   a mail client reads it (parse5, the HTML parser, so markup a client
 *   would re-nest counts as what it becomes);
 * - **corrected** — none of Summernote's known mistakes survive.
 *
 * What we do not get right yet is listed in `KNOWN`, each with its reason,
 * and runs as `it.fails`: the suite stays green, and the day one is fixed it
 * turns red and asks to be taken off the list.
 *
 * Real exported templates go in `fixtures/summernote/private/` (git-ignored:
 * customer data) and run through the same checks with no `KNOWN` list.
 */
import { parseFragment } from 'parse5';
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { emailExtensions } from './extensions/kits';

const fs = (globalThis as any).process.getBuiltinModule('fs');
const DIR = 'projects/angular-email-editor/src/lib/prose-mirror/fixtures/summernote/';

const schema = createSchema(emailExtensions);

/** What the composer does with a stored body: the editor's own parse. */
const open = (html: string): string => serializeToHTML(parseHTML(html, schema, { mode: 'email' }), schema);

// ── reading HTML the way a mail client does ─────────────────────────────

interface HtmlNode {
  nodeName: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
}

const tree = (html: string): HtmlNode => parseFragment(html) as unknown as HtmlNode;
const attr = (node: HtmlNode, name: string) => node.attrs?.find((a) => a.name === name)?.value;

function* walk(node: HtmlNode): Generator<HtmlNode> {
  yield node;
  for (const child of node.childNodes ?? []) yield* walk(child);
}

const BLOCKS = new Set([
  'div', 'p', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre',
  'table', 'tbody', 'tr', 'td', 'th', 'hr', 'br',
]);
const INLINES = new Set(['span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'font', 'a']);

/** `{{ x }}` and `{{x}}` as one spelling. The serializer writes a merge tag
    with a space inside each brace, and that is safe for core: its backend
    (iusta-utils' TextParser) finds `/{{(.*?)}}/` and compiles the inside
    as an Angular expression, which ignores the whitespace at its edges. The
    expression itself — string literals included — is never touched. */
const tight = (text: string) => text.replace(/\{\{\s*(.*?)\s*\}\}/g, '{{$1}}');

/** A link the correction made out of one of `embeds` — new, not kept. */
const madeFrom = (node: HtmlNode, embeds: string[]) =>
  node.nodeName === 'a' && embeds.includes(video(attr(node, 'href')));

/** The words, in order, with every block boundary a break; links made from
    `embeds` left out. */
function words(html: string, embeds: string[] = []): string[] {
  let text = '';
  const visit = (node: HtmlNode) => {
    if (madeFrom(node, embeds)) return;
    if (node.nodeName === '#text') text += node.value;
    if (BLOCKS.has(node.nodeName)) text += '\n';
    node.childNodes?.forEach(visit);
    if (BLOCKS.has(node.nodeName)) text += '\n';
  };
  visit(tree(html));
  return tight(text.replace(/\u00a0/g, ' ')).split(/\s+/).filter(Boolean);
}

/** Every `{{…}}`, in text and in attribute values, as written. */
function placeholders(html: string): string[] {
  const found: string[] = [];
  for (const node of walk(tree(html))) {
    if (node.nodeName === '#text') found.push(...(node.value!.match(/\{\{.*?\}\}/g) ?? []));
    for (const a of node.attrs ?? []) found.push(...(a.value.match(/\{\{.*?\}\}/g) ?? []));
  }
  return found;
}

const links = (html: string) => [...walk(tree(html))].filter((n) => n.nodeName === 'a').map((n) => attr(n, 'href'));
const images = (html: string) => [...walk(tree(html))].filter((n) => n.nodeName === 'img').map((n) => attr(n, 'src'));

/** Embedded players (Summernote's video button): a client shows none, so
    the intent — "watch this" — must survive as a link to the same address. */
const video = (url: string | undefined) =>
  /(?:\/embed\/|[?&]v=|vimeo\.com\/(?:video\/)?)([\w-]+)/.exec(url ?? '')?.[1] ??
  (url ?? '').replace(/^(https?:)?\/\//, '');
const media = (html: string) =>
  [...walk(tree(html))]
    .filter((n) => n.nodeName === 'iframe' || n.nodeName === 'video')
    .map((n) => video(attr(n, 'src')));
const linked = (html: string) => links(html).map(video);

/** A link target as its author meant it — Summernote's scheme quirks undone
    (the "corrected" checks prove they are; here they must not count as loss). */
const meant = (href: string | undefined) =>
  (href ?? '').replace(/^(mailto|tel):\/\//i, '$1:').replace(/^https?:\/\/(\{\{[^{}]*\}\})$/i, '$1');


/** A style attribute as text — never through a CSSOM (jsdom's misreads). */
function declarations(style: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (style ?? '').split(';')) {
    const at = part.indexOf(':');
    if (at > 0) map.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim().toLowerCase());
  }
  return map;
}

const NAMED: Record<string, string> = { gray: '#808080', grey: '#808080', red: '#ff0000', blue: '#0000ff' };

function color(value: string): string {
  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) return '#' + rgb.slice(1, 4).map((n) => (+n).toString(16).padStart(2, '0')).join('');
  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return NAMED[value] ?? value;
}

/** The first family, unquoted — the one a client with the font shows. */
const family = (value: string) => value.split(',')[0].trim().replace(/^["']|["']$/g, '');

function px(value: string): string {
  const m = value.match(/^([\d.]+)(px|pt)$/);
  if (!m) return value;
  return `${Math.round(m[2] === 'pt' ? (+m[1] * 4) / 3 : +m[1])}px`;
}

/** What a character looks like: inline formatting and the block it sits in. */
type Look = Record<string, string>;

function lookOf(node: HtmlNode, inherited: Look, depth: { list: number }): Look {
  const look = { ...inherited };
  const name = node.nodeName;
  if (name === 'b' || name === 'strong') look['bold'] = 'yes';
  if (name === 'i' || name === 'em') look['italic'] = 'yes';
  if (name === 'u') look['underline'] = 'yes';
  if (name === 's' || name === 'strike' || name === 'del') look['strike'] = 'yes';
  if (name === 'a') look['link'] = meant(attr(node, 'href'));
  if (name === 'font' && attr(node, 'color')) look['color'] = color(attr(node, 'color')!.toLowerCase());
  if (/^h[1-6]$/.test(name)) look['heading'] = name;
  if (name === 'blockquote') look['quote'] = 'yes';
  if (name === 'pre') look['mono'] = 'yes';
  if (name === 'td' || name === 'th') look['cell'] = 'yes';
  if (name === 'ul' || name === 'ol') look['list'] = `${name}${++depth.list}`;
  if (attr(node, 'align')) look['align'] = attr(node, 'align')!.toLowerCase();

  const style = declarations(attr(node, 'style'));
  const weight = style.get('font-weight');
  if (weight) look['bold'] = weight === 'bold' || +weight >= 600 ? 'yes' : 'no';
  if (style.get('font-style')) look['italic'] = style.get('font-style') === 'italic' ? 'yes' : 'no';
  const decoration = style.get('text-decoration') ?? style.get('text-decoration-line');
  if (decoration?.includes('underline')) look['underline'] = 'yes';
  if (decoration?.includes('line-through')) look['strike'] = 'yes';
  if (style.get('color')) look['color'] = color(style.get('color')!);
  if (style.get('background-color')) look['background'] = color(style.get('background-color')!);
  if (style.get('font-family')) look['font'] = family(style.get('font-family')!);
  if (style.get('font-size')) look['size'] = px(style.get('font-size')!);
  if (style.get('text-align') && style.get('text-align') !== 'left') look['align'] = style.get('text-align')!;
  if (style.get('margin-left') && BLOCKS.has(name)) look['indent'] = px(style.get('margin-left')!);
  return look;
}

/** Runs of text that look alike, whitespace aside: `[text, look]`; links
    made from `embeds` left out. */
function runs(html: string, embeds: string[] = []): [string, string][] {
  const out: [string, string][] = [];
  const visit = (node: HtmlNode, look: Look, depth: { list: number }) => {
    if (madeFrom(node, embeds)) return;
    if (node.nodeName === '#text') {
      const text = tight(node.value!.replace(/\u00a0/g, ' ')).replace(/\s+/g, '');
      if (!text) return;
      const key = Object.entries(look).sort().map(([k, v]) => `${k}=${v}`).join(' ');
      const last = out[out.length - 1];
      if (last && last[1] === key) last[0] += text;
      else out.push([text, key]);
      return;
    }
    const own = lookOf(node, look, depth);
    const inner = { list: depth.list };
    for (const child of node.childNodes ?? []) visit(child, own, inner);
  };
  visit(tree(html), {}, { list: 0 });
  return out;
}

// ── Summernote's mistakes ───────────────────────────────────────────────

/** Each a check over our output; an empty list is a pass. */
const MISTAKES: Record<string, (html: string) => string[]> = {
  /** `checkLinkUrl` prefixes a bare address with `mailto://` — no client
      reads that as the address. */
  'mailto:// links': (html) => links(html).filter((href) => /^mailto:\/\//i.test(href ?? '')) as string[],
  /** …and a bare placeholder with `http://`, which breaks the link the
      placeholder resolves to. */
  'scheme glued onto a placeholder': (html) =>
    links(html).filter((href) => /^https?:\/\/\{\{/i.test(href ?? '')) as string[],
  /** Word's own markup, which no client renders. */
  'Office markup': (html) =>
    [...walk(tree(html))]
      .filter((n) => n.nodeName.includes(':') || /\bMso/.test(attr(n, 'class') ?? ''))
      .map((n) => n.nodeName),
  /** A block inside an inline or a `<p>`: a client re-nests it and drops
      the inline's formatting on the way. */
  'block inside an inline or a <p>': (html) => {
    const found: string[] = [];
    // Read as markup, not as a parser re-nests it — the re-nesting is the bug.
    const raw = html.match(/<\/?[a-z][^>]*>/gi) ?? [];
    const stack: string[] = [];
    for (const tag of raw) {
      const name = tag.match(/^<\/?([a-z0-9:]+)/i)![1].toLowerCase();
      if (tag.startsWith('</')) {
        stack.splice(stack.lastIndexOf(name));
      } else if (!/^(br|hr|img|meta|input)$/.test(name) && !tag.endsWith('/>')) {
        const holder = [...stack].reverse().find((open) => INLINES.has(open) || open === 'p');
        if (holder && BLOCKS.has(name)) found.push(`${name} in ${holder}`);
        stack.push(name);
      }
    }
    return found;
  },
  /** Bootstrap's bordered table: borders in Summernote, none in the inbox. */
  'borders that were Bootstrap CSS': (html) =>
    [...walk(tree(html))]
      .filter((n) => n.nodeName === 'table' && /\btable-bordered\b/.test(attr(n, 'class') ?? ''))
      .filter((n) => !/border/.test(attr(n, 'style') ?? '') && !attr(n, 'border'))
      .map(() => 'table-bordered'),
};

// ── what is not right yet ───────────────────────────────────────────────

/** `file → check → why`. Each runs as `it.fails` until fixed. */
const KNOWN: Record<string, Record<string, string>> = {};


// ── the suite ───────────────────────────────────────────────────────────

const read = (path: string) => fs.readFileSync(path, 'utf8') as string;
const htmlIn = (dir: string): string[] =>
  fs.existsSync(dir) ? (fs.readdirSync(dir) as string[]).filter((f) => f.endsWith('.html')).sort() : [];

function corpus(title: string, dir: string, known: Record<string, Record<string, string>>) {
  if (!htmlIn(dir).length) return;
  describe(title, () => {
    for (const file of htmlIn(dir)) {
      describe(file, () => {
        const source = read(dir + file);
        const opened = open(source);
        const check = (name: string, body: () => void) => {
          const why = known[file]?.[name];
          if (why) it.fails(`${name} — KNOWN: ${why}`, body);
          else it(name, body);
        };

        check('opens and saves as itself the second time', () => expect(open(opened)).toBe(opened));
        check('kept: text', () => expect(words(opened, media(source))).toEqual(words(source)));
        check('kept: placeholders', () => expect(placeholders(opened).map(tight)).toEqual(placeholders(source).map(tight)));
        check('kept: link targets', () =>
          expect(links(opened).filter((href) => !media(source).includes(video(href)))).toEqual(links(source).map(meant)),
        );
        check('kept: images', () => expect(images(opened)).toEqual(images(source)));
        check('kept: embedded media as a link', () =>
          expect(media(source).filter((src) => !linked(opened).includes(src))).toEqual([]),
        );
        check('kept: formatting', () => expect(runs(opened, media(source))).toEqual(runs(source)));
        for (const [name, mistakes] of Object.entries(MISTAKES)) {
          check(name, () => expect(mistakes(opened)).toEqual([]));
        }

      });
    }
  });
}

describe('Summernote corpus', () => {
  it('has the generated scenarios', () => expect(htmlIn(DIR).length).toBeGreaterThanOrEqual(17));

  it('the oracle sees what a client sees', () => {
    // Mutation checks: each mistake detector and each "kept" reading must
    // notice the loss it exists for.
    expect(MISTAKES['mailto:// links']('<a href="mailto://a@b.de">x</a>')).toHaveLength(1);
    expect(MISTAKES['scheme glued onto a placeholder']('<a href="http://{{x}}">x</a>')).toHaveLength(1);
    expect(MISTAKES['Office markup']('<p class="MsoNormal">x<o:p></o:p></p>')).toHaveLength(2);
    expect(MISTAKES['block inside an inline or a <p>']('<span><div>x</div></span>')).toEqual(['div in span']);
    expect(MISTAKES['block inside an inline or a <p>']('<div><span>x</span></div><p>y</p>')).toEqual([]);
    expect(MISTAKES['borders that were Bootstrap CSS']('<table class="table table-bordered"></table>')).toHaveLength(1);
    expect(runs('<p><span style="color:red"><div>x</div></span></p>')).not.toEqual(runs('<span style="color:red">x</span>'));
    expect(runs('<font color="#FF0000">x</font>')).toEqual(runs('<span style="color: rgb(255, 0, 0)">x</span>'));
    expect(runs('<b>x</b>')).not.toEqual(runs('x'));
    expect(runs('<span style="font-size: 12pt">x</span>')).toEqual(runs('<span style="font-size:16px">x</span>'));
    expect(words('<div>a</div><div>b</div>')).toEqual(['a', 'b']);
    expect(words('<div>{{ a }}</div>')).toEqual(words('<div>{{a}}</div>'));
    expect(media('<iframe src="//www.youtube.com/embed/x"></iframe>')).toEqual(linked('<a href="https://www.youtube.com/embed/x">v</a>'));
    expect(media('<div></div>')).toEqual([]);
    expect(linked('<a href="https://www.youtube.com/watch?v=x">v</a>')).toEqual(media('<iframe src="//www.youtube.com/embed/x"></iframe>'));
    expect(meant('mailto://a@b.de')).toBe('mailto:a@b.de');
    expect(meant('http://{{link}}')).toBe('{{link}}');
    expect(meant('http://{{host}}/path')).toBe('http://{{host}}/path');
  });

  corpus('generated from Summernote 0.9.1 with core\'s patches', DIR, KNOWN);
  corpus('exported from production (private/)', `${DIR}private/`, {});
});
