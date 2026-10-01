import { parse, serialize } from 'parse5';
import { FOLD_WIDTH, foldHTML } from './fold';
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { emailExtensions } from './extensions/kits';
import { MJML_WORLDLY_HTML } from './fixtures/mjml-worldly';

const schema = createSchema(emailExtensions);

/** The document the HTML standard's parser builds from the markup — doctype,
    comments outside <html> and all — with scripting off (a mail client,
    DOMParser) and on (a browser tab, where <noscript> is raw text).
    Attribute whitespace is not part of it; every other character is.
    parse5 is the standard's tree construction as a pure function, the one
    jsdom wraps: no window, so thousands of parses cost the same each — a
    jsdom DOMParser keeps every document it made, and slows with each. */
const dom = (html: string): string =>
  [false, true].map((scriptingEnabled) => serialize(parse(html, { scriptingEnabled }))).join('\n—\n');

/** Our own reading of the markup — what the editor would make of it. */
const ours = (html: string) =>
  serializeToHTML(parseHTML(html, schema, { mode: 'preserve' }), schema);

const octets = (line: string) => new TextEncoder().encode(line).length;

/** The fold without its last-resort breaks before a `>` — for asserting on
    what a small width folded at spaces, and on text the fold left alone. */
const unbroken = (html: string) => html.split('\n>').join('>');
const widest = (html: string) => Math.max(...html.split('\n').map(octets));

/** The invariants every fold must keep, whatever the input. */
function expectSafe(html: string, width = FOLD_WIDTH): string {
  const folded = foldHTML(html, width);
  // 1. The same document, to a browser.
  expect(dom(folded)).toBe(dom(html));
  // 2. The only edits: a space or tab became a line break, or a line break
  //    was put right before a tag's closing `>` — never after a `/`.
  let i = 0;
  let j = 0;
  while (i < html.length || j < folded.length) {
    if (folded[j] === html[i]) {
      i++;
      j++;
    } else if (folded[j] === '\n' && (html[i] === ' ' || html[i] === '\t')) {
      i++;
      j++;
    } else {
      expect(folded[j]).toBe('\n');
      expect(html[i]).toBe('>');
      expect(html[i - 1]).not.toBe('/');
      j++; // the inserted break; the `>` follows it
    }
  }
  // 3. Folding again changes nothing.
  expect(foldHTML(folded, width)).toBe(folded);
  return folded;
}

describe('foldHTML', () => {
  it('leaves a document that already fits exactly as it is', () => {
    const html = '<div style="color:red">Hello <b>world</b></div>';
    expect(foldHTML(html)).toBe(html);
  });

  it('folds a long line only at a space between a tag’s attributes, and keeps every line within the width', () => {
    const cell = '<td align="center" style="font-size:0px;padding:10px 25px;" class="x">cell</td>';
    const html = `<table><tr>${cell.repeat(40)}</tr></table>`;
    expect(html.length).toBeGreaterThan(FOLD_WIDTH);
    const folded = expectSafe(html);
    expect(widest(folded)).toBeLessThanOrEqual(FOLD_WIDTH);
    // Every break sits right after an attribute or the tag name, inside a tag.
    for (const line of folded.split('\n').slice(1)) {
      expect(line).toMatch(/^(align|style|class)=/);
    }
  });

  it('counts the width in octets, as RFC 5322 does', () => {
    const cell = '<td title="Grüße aus Köln — 東京" style="padding:0">ü</td>';
    const html = cell.repeat(60);
    const folded = expectSafe(html, 200);
    expect(widest(folded)).toBeLessThanOrEqual(200);
    expect(folded.split('\n').some((line) => line.length < octets(line))).toBe(true);
  });

  it('counts every character of a comment into its line', () => {
    // 30 octets of comments and a tag name, then the tag's attribute: at 35
    // the fold must come after `<b` — a count that skipped the comments'
    // `!--` would think the whole line fits.
    const html = `${'<!---->'.repeat(4)}<b class="x">z</b>`;
    expect(expectSafe(html, 35)).toBe(`${'<!---->'.repeat(4)}<b\nclass="x">z</b>`);
  });

  it('never breaks inside an attribute value — quoted either way, or unquoted', () => {
    const html =
      '<a title="a > b = c &quot; d" href="https://x.io/a b" data-q=\'single " quote > here\' width=600 height=20 alt="x">link</a>';
    const folded = expectSafe(html.repeat(10), 30);
    expect(folded).toContain('title="a > b = c &quot; d"');
    expect(folded).toContain('href="https://x.io/a b"');
    expect(folded).toContain('data-q=\'single " quote > here\'');
    expect(folded).toMatch(/width=600\sheight=20\salt="x"/);
  });

  it('never touches text, however long — not even its spaces', () => {
    const text = 'word '.repeat(400);
    const html = `<div>${text}</div><pre>${'  keep   these   spaces  '.repeat(60)}</pre>`;
    const folded = expectSafe(html, 80);
    // No tag has a space to fold at: at most a break before a `>`.
    expect(unbroken(folded)).toBe(html);
    expect(folded).toContain(text);
  });

  it('never touches a comment — Outlook’s conditional comments above all', () => {
    const conditional =
      '<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;" width="600"><tr><td style="line-height:0px;font-size:0px;"><![endif]-->';
    const revealed = '<!--[if !mso]><!--><meta http-equiv="X-UA-Compatible" content="IE=edge"><!--<![endif]-->';
    const html = `<div class="a b">${conditional}${revealed}<!-- a "quoted" > comment <td a="1" b="2"> -->x</div>`;
    const folded = expectSafe(html.repeat(5), 40);
    expect(folded).toContain(conditional);
    expect(folded).toContain('<!-- a "quoted" > comment <td a="1" b="2"> -->');
  });

  it('knows the comment forms a tokenizer ends early: <!-->, <!--->, --!>', () => {
    const html =
      '<!--><p class="a b">after empty</p><!---><p class="c d">after dash</p><!-- x --!><p class="e f">after bang</p>';
    const folded = expectSafe(html, 10);
    // The paragraphs after each early-ended comment are markup again: folded.
    expect(unbroken(folded)).toContain('<p\nclass="a b">');
    expect(unbroken(folded)).toContain('<p\nclass="e f">');
  });

  it('never touches raw text — style, title, textarea, noscript — even when it looks like tags', () => {
    const html =
      '<style>td { padding: 0 } /* <td class="a b" style="x y"> */</style>' +
      '<title>A <b class="x y">title</b></title>' +
      '<textarea name="t" rows="3"><td class="a b"></textarea>' +
      '<noscript><img src="a.png" alt="no script"></noscript>' +
      '<div class="after raw">x</div>';
    const folded = expectSafe(html, 12);
    expect(unbroken(folded)).toContain('/* <td class="a b" style="x y"> */');
    expect(unbroken(folded)).toContain('<title>A <b class="x y">title</b></title>');
    expect(unbroken(folded)).toContain('<textarea\nname="t"\nrows="3"><td class="a b"></textarea>');
    expect(unbroken(folded)).toContain('<noscript><img src="a.png" alt="no script"></noscript>');
    // Past the raw text, markup is markup again.
    expect(unbroken(folded)).toContain('<div\nclass="after raw">');
  });

  it('reads a raw text end tag the way the tokenizer does — only the matching name ends it', () => {
    const html = '<style>a</styles><b c="1 2"></STYLE ><i class="x y">i</i>';
    const folded = expectSafe(html, 6);
    expect(unbroken(folded)).toContain('<style>a</styles><b c="1 2"></STYLE >');
    expect(unbroken(folded)).toContain('<i\nclass="x y">');
  });

  it('never touches a doctype, a CDATA section or a processing instruction', () => {
    const html =
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">' +
      // In HTML a CDATA section is a bogus comment to its first `>` — what
      // follows is markup to a browser. Skipping to `]]>` folds less there,
      // never wrongly.
      '<html><body><?xml version="1.0" encoding="utf-8"?><div title="t u"><![CDATA[ a > b <c d="e f"> ]]></div><p class="a b">x</p></body></html>';
    const folded = expectSafe(html, 10);
    expect(unbroken(folded).split('\n')[0]).toBe(html.slice(0, html.indexOf('<html>')) + '<html><body><?xml version="1.0" encoding="utf-8"?><div');
    expect(folded).toContain('<![CDATA[ a > b <c d="e f"> ]]>');
    expect(unbroken(folded)).toContain('<p\nclass="a b">');
  });

  it('knows text that only looks like a tag: a < b, <3, < div, </ x>', () => {
    const html = '<div class="a b">1 < 2 and 3 > 2, <3, < div class="no", </ x class="no"></div>';
    const folded = expectSafe(html, 5);
    expect(unbroken(folded)).toContain('1 < 2 and 3 > 2, <3, < div class="no", </ x class="no">');
  });

  it('folds the spaces of the tag grammar only: around =, before / and >, in any case', () => {
    const html = '<IMG SRC = "a.png"   ALT= "b c" /><br class="x" /><TD\tALIGN="center">t</TD>';
    const folded = expectSafe(html, 4);
    expect(folded).not.toContain(' '.repeat(3) + 'ALT'); // those spaces are fold points
    expect(folded).toContain('"b c"');
  });

  it('never folds inside an end tag, and keeps line breaks already there', () => {
    const html = '<div class="a">x</div  >\n<p class="b c">y</p>';
    const folded = expectSafe(html, 3);
    // The spaces inside the end tag stay spaces.
    expect(folded).toMatch(/<\/div {2}\n?>/);
    expect(unbroken(folded).startsWith('<div\nclass="a">x</div  >\n<p\nclass="b')).toBe(true);
  });

  it('falls back to a break before a tag’s > where a run has no space to fold at — Outlook’s conditionals', () => {
    // MJML: a cell's style, then conditional comments and end tags — no space
    // the tokenizer ignores between them, far past the width.
    const conditional =
      '<!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;" width="600"><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->';
    const html = `<td style="direction:ltr;font-size:0px;">${conditional}</td></tr></tbody></table></div>${conditional}</td></tr></tbody></table></div>${conditional}<div class="x">y</div>`;
    const folded = expectSafe(html, 300);
    expect(widest(folded)).toBeLessThanOrEqual(300);
    // Spaces first: a break before a > only where no space would do.
    expect(folded.startsWith('<td\nstyle=')).toBe(true);
    expect(folded).toMatch(/<\/\w+\n>/);
    // The comments themselves are untouched.
    expect(folded.split(conditional).length).toBe(4);
  });

  it('reads = where a name is expected as the name, as the tokenizer does — so a quoted value stays whole', () => {
    // `=="c d"`: the first `=` starts an attribute *name*, the second begins
    // its value — "c d" is quoted, and its space is not the tag's.
    const html = '<a =="c d" e ="f g" =h i=\'j k\'>x</a>'.repeat(6);
    const folded = expectSafe(html, 6);
    expect(unbroken(folded)).toContain('"c d"');
    expect(unbroken(folded)).toContain('"f g"');
    expect(unbroken(folded)).toContain("'j k'");
  });

  it('folds nothing after <svg>, <math>, <script> or <plaintext> — where a tokenizer alone cannot be sure', () => {
    // Inside SVG, <title> and <style> follow other rules than in HTML; a
    // script's end hides in `<!--<script>` escapes; plaintext never ends.
    const tail = '<p class="a b">after</p>'.repeat(4);
    for (const opener of [
      '<svg><title><pre>x</pre><style>y <title />z</title><b c="1 2"></style></title></svg>',
      '<math><mi class="a b">x</mi></math>',
      '<script><!--<script></script><b c="1 2"></script>',
      '<plaintext></plaintext>',
    ]) {
      const html = `<div class="before it">x</div>${opener}${tail}`;
      const folded = expectSafe(html, 8);
      expect(folded.startsWith('<div\nclass="before')).toBe(true);
      // The opening tag is still HTML's (a break before its `>` is fine);
      // everything after it is left exactly as it was.
      const content = opener.slice(opener.indexOf('>') + 1) + tail;
      expect(folded.endsWith(content)).toBe(true);
    }
  });

  it('ends raw text only at the name the standard knows, followed by what it allows', () => {
    // A no-break space is no end-tag delimiter; the Kelvin sign is no K.
    const html = '<style>a</style ><b c="1 2"></style><i class="x y">i</i>';
    const folded = expectSafe(html, 6);
    expect(unbroken(folded)).toContain('</style ><b c="1 2"></style>');
    expect(unbroken(folded)).toContain('<i\nclass="x y">');
  });

  it('never breaks between / and > — the slash would stop closing the element', () => {
    const html = '<p class="a b"><br/><img src="x y" alt="z"/><input type="text" /></p>'.repeat(4);
    const folded = expectSafe(html, 8);
    expect(folded).not.toMatch(/\/\n>/);
    expect(unbroken(folded)).toContain('<br/>');
    expect(unbroken(folded)).toContain('alt="z"/>');
  });

  it('leaves a line long where the only way to fold would change something', () => {
    const value = 'x'.repeat(2000);
    const html = `<div title="${value}">text</div>`;
    const folded = expectSafe(html);
    expect(unbroken(folded)).toBe(`<div\ntitle="${value}">text</div>`);
    expect(widest(folded)).toBeGreaterThan(FOLD_WIDTH);
  });

  it('keeps a compiled MJML template the same document — to a browser and to the editor', () => {
    const minified = MJML_WORLDLY_HTML.replace(/\n\s*/g, ' ');
    const folded = expectSafe(minified, 120);
    // What stays wider has nothing it may fold at: a comment, the head's
    // stylesheet (raw text, one line once minified), or one attribute whose
    // value alone is wider — a value is never folded.
    for (const line of folded.split('\n')) {
      if (octets(line) <= 120) continue;
      expect(
        line.includes('<!--') || line.includes('{') || /="[^"]{80,}"/.test(line),
        line,
      ).toBe(true);
    }
    expect(folded.split('\n').length).toBeGreaterThan(50);
    expect(ours(folded)).toBe(ours(minified));
  });

  it('holds up against random tag soup — the same document, every time', () => {
    // A seeded generator (mulberry32, exact in 32-bit integer arithmetic):
    // the same thousands of cases on every run. A float LCG loses its low
    // bits past 2^53 and cycles — once 1500 runs were ~150 cases.
    let seed = 20261001;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const names = ['div', 'td', 'TABLE', 'a', 'img', 'span', 'p', 'pre', 'style', 'title', 'textarea', 'br', 'svg', 'x-y'];
    const values = ['', 'a b', 'x>y', "it's", 'say "hi"', 'a=b', ' lead', 'tail ', '<b>', 'ü 東', '\t'];
    const spaces = [' ', '  ', '\t', ' \t ', '\n'];
    const attribute = () => {
      const name = pick(['class', 'style', 'data-x', 'ALT', 'width', 'href']);
      const value = pick(values);
      switch (Math.floor(random() * 7)) {
        case 5:
          // `=` where a name is expected starts a name: `="x y"` is odd, and legal.
          return `="${value.replace(/"/g, '')}"`;
        case 6:
          return `${pick(['', ' '])}=="${value.replace(/"/g, '')}"`;
        case 0:
          return name;
        case 1:
          return `${name}=${value.replace(/[\s"'=<>`]/g, '') || 'v'}`;
        case 2:
          return `${name}='${value.replace(/'/g, '')}'`;
        case 3:
          return `${name}${pick([' ', ''])}=${pick([' ', ''])}"${value.replace(/"/g, '&quot;')}"`;
        default:
          return `${name}="${value.replace(/"/g, '')}"`;
      }
    };
    const piece = (depth: number): string => {
      const roll = random();
      if (roll < 0.25) return pick(['text with  spaces ', 'a < b ', '1 > 0 ', '&amp; ', 'ü東 ', '<3 ', '</ x> ']);
      if (roll < 0.33) return pick(['<!-- c "q" > <td a="1 2"> -->', '<!--[if mso]><td a="1 2"><![endif]-->', '<!---->', '<!-->', '<!--[if !mso]><!-->']);
      if (roll < 0.36) return pick(['<!doctype html>', '<?pi a b?>', '<![CDATA[ x <y z="1 2"> ]]>']);
      if (roll < 0.40) return pick(['<svg><path d="a b"/><g class="x y"><circle r="1"/></g></svg>', '<br/>', '<br />', '<img src=x/>', '<p/>']);
      const name = pick(names);
      const attrs = Array.from({ length: Math.floor(random() * 4) }, () => pick(spaces) + attribute()).join('');
      const open = `<${name}${attrs}${pick(['', ' ', ' /', '\t'])}>`;
      if (name === 'br' || name === 'img') return open;
      const inner =
        depth > 3 ? 'leaf' : Array.from({ length: 1 + Math.floor(random() * 3) }, () => piece(depth + 1)).join('');
      return `${open}${inner}</${name}${pick(['', ' '])}>`;
    };
    const runs = 3000;
    const cases = new Set<string>();
    let folds = 0;
    for (let run = 0; run < runs; run++) {
      const html = Array.from({ length: 1 + Math.floor(random() * 4) }, () => piece(0)).join('');
      cases.add(html);
      if (expectSafe(html, 1 + Math.floor(random() * 30)) !== html) folds++;
    }
    // The fuzz tests what it claims: thousands of distinct cases, most of
    // them actually folded.
    expect(cases.size).toBeGreaterThan(runs * 0.8);
    expect(folds).toBeGreaterThan(runs * 0.7);
  });
});
