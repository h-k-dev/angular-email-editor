/**
 * Render fidelity of the app's MJML examples — `npm run test:render`, in real
 * Chromium (jsdom has no layout, so the everyday `ng test` skips this file).
 *
 * Each example takes the path a paste of the whole document takes: the source
 * pane formats it, the editor parses it (`email` mode), the email is its
 * serialization. The result must lay out exactly like the original — every
 * text run, image and painted box (background, border) at the same pixel, the
 * same height — at desktop width and at phone width, where the columns stack.
 * What layout cannot see is compared as markup: links, image sources and the
 * conditional comments Outlook reads.
 */
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { formatHTML } from './html-source';
import { emailExtensions } from './extensions/kits';
import { emailDocument } from './email-document';

import appointmentAlert from '../../../../app/public/examples/mjml/appointment-alert.html' with {
  loader: 'text',
};
import arturia from '../../../../app/public/examples/mjml/arturia.html' with { loader: 'text' };
import austin from '../../../../app/public/examples/mjml/austin.html' with { loader: 'text' };
import card from '../../../../app/public/examples/mjml/card.html' with { loader: 'text' };
import foodDelivery from '../../../../app/public/examples/mjml/food-delivery.html' with {
  loader: 'text',
};
import happyNewYear from '../../../../app/public/examples/mjml/happy-new-year.html' with {
  loader: 'text',
};
import loyalClient from '../../../../app/public/examples/mjml/loyal-client.html' with {
  loader: 'text',
};
import nyaCart from '../../../../app/public/examples/mjml/nya-cart.html' with { loader: 'text' };
import racoon from '../../../../app/public/examples/mjml/racoon.html' with { loader: 'text' };
import worldly from '../../../../app/public/examples/mjml/worldly.html' with { loader: 'text' };

import inducedAppointmentAlert from '../../../../app/public/examples/mjml-induce/appointment-alert.html' with {
  loader: 'text',
};
import inducedArturia from '../../../../app/public/examples/mjml-induce/arturia.html' with {
  loader: 'text',
};
import inducedAustin from '../../../../app/public/examples/mjml-induce/austin.html' with {
  loader: 'text',
};
import inducedCard from '../../../../app/public/examples/mjml-induce/card.html' with {
  loader: 'text',
};
import inducedFoodDelivery from '../../../../app/public/examples/mjml-induce/food-delivery.html' with {
  loader: 'text',
};
import inducedHappyNewYear from '../../../../app/public/examples/mjml-induce/happy-new-year.html' with {
  loader: 'text',
};
import inducedLoyalClient from '../../../../app/public/examples/mjml-induce/loyal-client.html' with {
  loader: 'text',
};
import inducedNyaCart from '../../../../app/public/examples/mjml-induce/nya-cart.html' with {
  loader: 'text',
};
import inducedRacoon from '../../../../app/public/examples/mjml-induce/racoon.html' with {
  loader: 'text',
};
import inducedWorldly from '../../../../app/public/examples/mjml-induce/worldly.html' with {
  loader: 'text',
};

/** The replicas `mjml-induce.spec.ts` writes under jsdom, by example. */
const INDUCED: Record<string, string> = {
  'appointment-alert': inducedAppointmentAlert,
  arturia: inducedArturia,
  austin: inducedAustin,
  card: inducedCard,
  'food-delivery': inducedFoodDelivery,
  'happy-new-year': inducedHappyNewYear,
  'loyal-client': inducedLoyalClient,
  'nya-cart': inducedNyaCart,
  racoon: inducedRacoon,
  worldly: inducedWorldly,
};

const EXAMPLES: Record<string, string> = {
  'appointment-alert': appointmentAlert,
  arturia,
  austin,
  card,
  'food-delivery': foodDelivery,
  'happy-new-year': happyNewYear,
  'loyal-client': loyalClient,
  'nya-cart': nyaCart,
  racoon,
  worldly,
};

/** Desktop, and a phone — below MJML's 480px breakpoint, columns stack. */
const WIDTHS = [600, 375];

/** How long an example's remote images get to load (they are the same
    images on both sides, so a failed load still compares like for like). */
const IMAGE_WAIT = 10_000;

const schema = createSchema(emailExtensions);

/** What a paste of the whole document becomes in the email. */
function pasted(html: string): string {
  const source = formatHTML(html, undefined, undefined, { mode: 'email' });
  return serializeToHTML(parseHTML(source, schema, { mode: 'email' }), schema);
}

interface Mark {
  kind: 'text' | 'img' | 'box';
  /** The text, the image file, or the paint. */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The document laid out at `width`, its images settled. Tall enough that no
    scrollbar takes width from either side. */
async function render(html: string, width: number): Promise<HTMLIFrameElement> {
  const frame = document.createElement('iframe');
  frame.style.cssText = `position: absolute; left: 0; top: 0; border: 0; width: ${width}px; height: 6000px;`;
  const loaded = new Promise((resolve) => (frame.onload = resolve));
  frame.srcdoc = html;
  document.body.append(frame);
  await loaded;
  const images = Array.from(frame.contentDocument!.images);
  const settle = (list: HTMLImageElement[]) =>
    Promise.race([
      Promise.all(
        list.map((img) =>
          img.complete ? null : new Promise((done) => (img.onload = img.onerror = done)),
        ),
      ),
      new Promise((done) => setTimeout(done, IMAGE_WAIT)),
    ]);
  await settle(images);
  // A remote image that failed (a slow redirect, a hiccup) draws as a 16px
  // icon on one side only: asked for again, it comes — from the cache, when
  // the other side has it.
  for (let attempt = 0; attempt < IMAGE_RETRIES; attempt++) {
    const failed = images.filter((img) => img.complete && !img.naturalWidth);
    if (!failed.length) break;
    for (const img of failed) img.src = img.src;
    await settle(failed);
  }
  return frame;
}

/** How often a failed image is asked for again. */
const IMAGE_RETRIES = 3;

/** Both renderings, one after the other: the second draws its images from
    the cache the first filled, never racing it to the network. */
async function renderBoth(
  a: string,
  b: string,
  width: number,
): Promise<[HTMLIFrameElement, HTMLIFrameElement]> {
  const first = await render(a, width);
  return [first, await render(b, width)];
}

const box = (r: DOMRect) => ({
  x: Math.round(r.left),
  y: Math.round(r.top),
  w: Math.round(r.width),
  h: Math.round(r.height),
});

/** Everything that paints, in document order. */
function marksOf(doc: Document): Mark[] {
  const marks: Mark[] = [];
  const view = doc.defaultView!;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width || rect.height) marks.push({ kind: 'text', id: text, ...box(rect) });
      continue;
    }
    const element = node as HTMLElement;
    if (element.tagName === 'IMG') {
      const file = (element.getAttribute('src') ?? '').split('/').pop() ?? '';
      marks.push({ kind: 'img', id: file, ...box(element.getBoundingClientRect()) });
      continue;
    }
    const style = view.getComputedStyle(element);
    const paint = [
      style.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : style.backgroundColor,
      style.backgroundImage === 'none' ? '' : style.backgroundImage,
      ...(['Top', 'Right', 'Bottom', 'Left'] as const).map((side) =>
        parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
        style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none'
          ? `${side} ${style.getPropertyValue(`border-${side.toLowerCase()}-width`)} ${style.getPropertyValue(`border-${side.toLowerCase()}-color`)}`
          : '',
      ),
    ]
      .filter(Boolean)
      .join(' ');
    if (!paint) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) marks.push({ kind: 'box', id: paint, ...box(rect) });
  }
  return marks;
}

const same = (a: Mark, b: Mark) =>
  a.id === b.id && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Text and images pair in order (the same content, in the same order);
    boxes pair by paint and place, since a wrapper may differ while the
    picture does not. */
function differences(source: Mark[], result: Mark[]): string[] {
  const found: string[] = [];
  for (const kind of ['text', 'img'] as const) {
    const a = source.filter((m) => m.kind === kind);
    const b = result.filter((m) => m.kind === kind);
    if (a.length !== b.length) found.push(`${kind}: ${a.length} → ${b.length}`);
    a.forEach((mark, i) => {
      if (!b[i] || !same(mark, b[i]))
        found.push(`${kind} ${JSON.stringify(mark)} → ${JSON.stringify(b[i] ?? null)}`);
    });
  }
  const unmatched = result.filter((m) => m.kind === 'box');
  for (const mark of source.filter((m) => m.kind === 'box')) {
    const i = unmatched.findIndex((other) => same(mark, other));
    if (i >= 0) unmatched.splice(i, 1);
    else found.push(`box lost ${JSON.stringify(mark)}`);
  }
  for (const mark of unmatched) found.push(`box gained ${JSON.stringify(mark)}`);
  return found;
}

async function layoutDifferences(source: string, result: string, width: number): Promise<string[]> {
  const [a, b] = await renderBoth(source, result, width);
  try {
    const docA = a.contentDocument!;
    const docB = b.contentDocument!;
    const found = differences(marksOf(docA), marksOf(docB));
    const heights = [docA.documentElement.scrollHeight, docB.documentElement.scrollHeight];
    if (heights[0] !== heights[1]) found.unshift(`height ${heights[0]} → ${heights[1]}`);
    return found;
  } finally {
    a.remove();
    b.remove();
  }
}

/** What layout cannot show: where links go, which images load, and what
    Outlook reads from the conditional comments (whitespace aside — the head
    is stored with its comments re-indented). */
function markup(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const comments: string[] = [];
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    comments.push((node.nodeValue ?? '').replace(/\s+/g, ' ').trim());
  }
  return {
    links: Array.from(doc.querySelectorAll('a'), (a) => a.getAttribute('href')),
    images: Array.from(doc.querySelectorAll('img'), (img) => img.getAttribute('src')),
    comments,
  };
}

describe('MJML examples render as authored after a paste', () => {
  for (const [name, html] of Object.entries(EXAMPLES)) {
    for (const width of WIDTHS) {
      it(`${name} lays out the same at ${width}px`, { timeout: 30_000 }, async () => {
        expect(await layoutDifferences(html, pasted(html), width)).toEqual([]);
      });
    }

    it(`${name} keeps its links, images and conditional comments`, () => {
      expect(markup(pasted(html))).toEqual(markup(html));
    });
  }

  // The harness itself: a stray <br> in Card's 30px divider moves the page by
  // one pixel — the regression this suite was written for.
  it('sees a one-pixel change', { timeout: 30_000 }, async () => {
    const broken = card.replace(/(width:30px;">)\s*(<\/p>)/, '$1<br>$2');
    expect(broken).not.toBe(card);
    expect((await layoutDifferences(card, broken, 600)).length).toBeGreaterThan(0);
  });
});

// --- The builder import: the same email in our own blocks --------------------

/** What the builder import makes of a document — our own sections, columns
    and buttons — sent in our email document. */
function imported(html: string): string {
  return emailDocument(serializeToHTML(parseHTML(html, schema), schema));
}

/** The original as the import is meant to keep it. Without its web fonts:
    the import carries no head, so its words fall back to the stack's own
    faces — compared on those, the test measures the blocks, not a font
    download. Without MJML's menu checkbox: the hamburger is a trick only
    some clients play, and the import brings a navbar in as the row of
    links every other client shows — the original, with no checkbox for
    the menu's rules to match. */
const reference = (html: string): string =>
  html
    .replace(/<link[^>]*fonts\.googleapis[^>]*>/gi, '')
    .replace(/@import url\([^)]*\);?/gi, '')
    .replace(/<input[^>]*mj-menu-checkbox[^>]*>/gi, '');

/** A face's kind, off the first family the browser knows the kind of. */
const KINDS: Record<string, string> = {
  'sans-serif': 'sans',
  arial: 'sans',
  helvetica: 'sans',
  'system-ui': 'sans',
  serif: 'serif',
  georgia: 'serif',
  times: 'serif',
  'times new roman': 'serif',
  monospace: 'mono',
  courier: 'mono',
};

const kindOf = (family: string): string =>
  family
    .toLowerCase()
    .split(',')
    .map((part) => KINDS[part.replace(/["']/g, '').trim()])
    .find(Boolean) ?? 'other';

interface Word {
  text: string;
  color: string;
  kind: string;
  size: number;
  bold: boolean;
  underline: boolean;
  /** Line height over font size — `normal` read as 1.2. */
  leading: number;
  /** The line height in px. */
  lineHeight: number;
  /** Where the box the word's line sits in starts, and how wide it is. */
  left: number;
  width: number;
}

/** The box a run lays its lines out in — a block, or a button's
    inline-block. */
function blockOf(node: Node): HTMLElement {
  let el = node.parentElement!;
  const view = el.ownerDocument.defaultView!;
  while (
    el.parentElement &&
    !/^(block|inline-block|list-item|table-cell)$/.test(view.getComputedStyle(el).display)
  ) {
    el = el.parentElement;
  }
  return el;
}

/** Every visible word, in order, with how it is drawn. */
function wordsOf(doc: Document): Word[] {
  const view = doc.defaultView!;
  const words: Word[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').trim();
    if (!text) continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = view.getComputedStyle(node.parentElement!);
    const size = parseFloat(style.fontSize);
    const lineHeight = style.lineHeight === 'normal' ? size * 1.2 : parseFloat(style.lineHeight);
    let underline = false;
    for (let el: HTMLElement | null = node.parentElement; el; el = el.parentElement) {
      if (/underline/.test(view.getComputedStyle(el).textDecorationLine)) underline = true;
    }
    const block = blockOf(node).getBoundingClientRect();
    for (const word of text.split(/\s+/)) {
      words.push({
        text: word,
        color: style.color,
        kind: kindOf(style.fontFamily),
        size,
        bold: parseInt(style.fontWeight, 10) >= 600,
        underline,
        leading: lineHeight / size,
        lineHeight,
        left: Math.round(block.left),
        width: Math.round(block.width),
      });
    }
  }
  return words;
}

/** Each text link: its words, and how many lines it takes. */
function linksOf(doc: Document): { text: string; lines: number }[] {
  return Array.from(doc.querySelectorAll('a'))
    .filter((a) => (a.textContent ?? '').trim() && a.getBoundingClientRect().width)
    .map((a) => {
      const range = doc.createRange();
      range.selectNodeContents(a);
      const tops = new Set(Array.from(range.getClientRects(), (r) => Math.round(r.top)));
      return { text: (a.textContent ?? '').replace(/\s+/g, ' ').trim(), lines: tops.size };
    });
}

/** Each visible image: its file and its drawn width. */
function imagesOf(doc: Document): { file: string; width: number }[] {
  return Array.from(doc.images)
    .filter((img) => img.getBoundingClientRect().width)
    .map((img) => ({
      file: (img.getAttribute('src') ?? '').split('/').pop() ?? '',
      width: Math.round(img.getBoundingClientRect().width),
    }));
}

/** Line height over size: the ladder's snapped size moves a px line height's ratio a little. */
const LEADING_SLACK = 0.15;
/** Our columns budget 560px of the 600 for a client's insets: a box may start that much off. */
const BOX_SLACK = 30;
/** Snapped sizes and our own spacing add up over a long email. */
const HEIGHT_SLACK = 0.2;

/** Where the import's rendering strays from the original's past what our
    blocks allow — each kind of difference once, with its count and first
    case. */
async function importDifferences(source: string, result: string, width: number): Promise<string[]> {
  const [a, b] = await renderBoth(source, result, width);
  try {
    const found: string[] = [];
    const docA = a.contentDocument!;
    const docB = b.contentDocument!;
    const wordsA = wordsOf(docA);
    const wordsB = wordsOf(docB);
    const textA = wordsA.map((w) => w.text).join(' ');
    const textB = wordsB.map((w) => w.text).join(' ');
    if (textA.replace(/\s/g, '') !== textB.replace(/\s/g, '')) {
      let i = 0;
      while (textA[i] === textB[i]) i++;
      return [
        `words differ at ${JSON.stringify(textA.slice(Math.max(0, i - 20), i + 30))} → ${JSON.stringify(textB.slice(Math.max(0, i - 20), i + 30))}`,
      ];
    }
    const strays = new Map<string, { count: number; first: string }>();
    const stray = (kind: string, word: string, from: unknown, to: unknown) => {
      const entry = strays.get(kind) ?? { count: 0, first: `"${word}" ${from} → ${to}` };
      entry.count++;
      strays.set(kind, entry);
    };
    // Words pair one to one once the joins agree.
    const pairs = Math.min(wordsA.length, wordsB.length);
    for (let i = 0; i < pairs; i++) {
      const [x, y] = [wordsA[i], wordsB[i]];
      if (x.color !== y.color) stray('colour', x.text, x.color, y.color);
      if (x.kind !== y.kind) stray('face', x.text, x.kind, y.kind);
      if (x.bold !== y.bold) stray('weight', x.text, x.bold, y.bold);
      if (x.underline !== y.underline) stray('underline', x.text, x.underline, y.underline);
      if (Math.abs(x.size - y.size) > Math.max(2, x.size * 0.25)) {
        stray('size', x.text, x.size, y.size);
      }
      // Either measure holds: a px line height keeps its px on a snapped
      // size, a factor keeps its ratio.
      if (
        Math.abs(x.leading - y.leading) > LEADING_SLACK &&
        Math.abs(x.lineHeight - y.lineHeight) > 2
      ) {
        stray('line height', x.text, x.leading.toFixed(2), y.leading.toFixed(2));
      }
      if (Math.abs(x.left - y.left) > BOX_SLACK) stray('box start', x.text, x.left, y.left);
      if (Math.abs(x.width - y.width) > Math.max(BOX_SLACK, x.width * 0.15)) {
        stray('box width', x.text, x.width, y.width);
      }
    }
    for (const [kind, { count, first }] of strays) {
      found.push(`${kind}: ${count} words, first ${first}`);
    }

    const linksA = linksOf(docA);
    const linksB = linksOf(docB);
    if (linksA.map((l) => l.text).join('|') !== linksB.map((l) => l.text).join('|')) {
      found.push(
        `links: ${JSON.stringify(linksA.map((l) => l.text))} → ${JSON.stringify(linksB.map((l) => l.text))}`,
      );
    } else {
      linksA.forEach((link, i) => {
        if (linksB[i].lines > link.lines) {
          found.push(`link "${link.text}" wraps: ${link.lines} → ${linksB[i].lines} lines`);
        }
      });
    }

    const imagesA = imagesOf(docA);
    const imagesB = imagesOf(docB);
    if (imagesA.map((i) => i.file).join('|') !== imagesB.map((i) => i.file).join('|')) {
      found.push(`images: ${imagesA.length} → ${imagesB.length}`);
    } else {
      imagesA.forEach((img, i) => {
        if (Math.abs(img.width - imagesB[i].width) > Math.max(4, img.width * 0.1)) {
          found.push(`image ${img.file}: ${img.width}px → ${imagesB[i].width}px`);
        }
      });
    }

    const heights = [docA.documentElement.scrollHeight, docB.documentElement.scrollHeight];
    if (Math.abs(heights[0] - heights[1]) > heights[0] * HEIGHT_SLACK) {
      found.unshift(`height ${heights[0]} → ${heights[1]}`);
    }
    return found;
  } finally {
    a.remove();
    b.remove();
  }
}

/** Where our blocks cannot yet draw what MJML draws — gaps of the model, not
    of the import — with the kind of difference each shows. A gap that no
    longer shows fails the test as well: it is closed, and comes off. */
const INSET = "the section keeps its own 16px inset, not MJML's side padding";
const BUDGET = 'a lone column is capped at the 560px side-by-side budget, not 600px';
const FIXED_WIDTH = "a button keeps no fixed width (MJML's `width`)";
const LINKLESS = "a button without a link (MJML's `<p>` box) reads as a line";
const ROW = 'a row narrower than the container sits left, not centred';

const KNOWN: Record<string, [kind: string, why: string][]> = {
  'appointment-alert@375': [['box width', INSET]],
  'austin@375': [
    ['box start', INSET],
    ['box width', BUDGET],
    ['link', BUDGET],
    ['image', BUDGET],
  ],
  'austin@600': [
    ['box start', INSET],
    ['box width', FIXED_WIDTH],
    ['image', BUDGET],
  ],
  'card@600': [['box start', ROW]],
  'food-delivery@375': [['box width', INSET]],
  'loyal-client@375': [
    ['box width', INSET],
    ['box start', LINKLESS],
  ],
  'loyal-client@600': [
    ['box start', LINKLESS],
    ['box width', LINKLESS],
  ],
  'worldly@600': [['box start', BUDGET]],
};

// The replica the bench shows is what the editor makes: the import must
// come out the same in a browser as in the jsdom that wrote the file.
// Where it does not, an engine's CSSOM is reading the markup differently
// (jsdom drops a longhand written after its shorthand), and a pass is
// reading through the CSSOM where it should read the authored text.
describe('MJML examples induced in Chromium are the committed replicas', () => {
  for (const [name, html] of Object.entries(EXAMPLES)) {
    it(`${name}: the browser’s import is the file jsdom wrote`, () => {
      const made = `${formatHTML(serializeToHTML(parseHTML(html, schema), schema))}\n`;
      expect(made).toBe(INDUCED[name].replace(/\r\n/g, '\n'));
    });
  }
});

describe('MJML examples imported as our own blocks look like the original', () => {
  for (const [name, html] of Object.entries(EXAMPLES)) {
    for (const width of WIDTHS) {
      it(
        `${name} at ${width}px: the same words, drawn as our blocks allow`,
        { timeout: 30_000 },
        async () => {
          const found = await importDifferences(reference(html), imported(html), width);
          const known = KNOWN[`${name}@${width}`] ?? [];
          expect(found.filter((f) => !known.some(([kind]) => f.startsWith(kind)))).toEqual([]);
          expect(
            known
              .filter(([kind]) => !found.some((f) => f.startsWith(kind)))
              .map(([kind, why]) => `closed: ${kind} — ${why}`),
          ).toEqual([]);
        },
      );
    }
  }

  // The harness itself: each of the import's fixes, undone on Racoon's
  // import, is seen — the face, the line height, the phone width, the
  // label on one line, the nav links' bare face.
  const undone: [what: string, width: number, undo: (html: string) => string, kind: string][] = [
    [
      'the web font read as Sans-serif',
      600,
      (h) => h.replace(/font-family: Arial, Helvetica, sans-serif;?/g, ''),
      'face',
    ],
    ['the line height', 600, (h) => h.replace(/line-height: [^;"]+;?/g, ''), 'line height'],
    [
      'a stacked column full width on a phone',
      375,
      (h) => h.replace(/class="aee-stack" /g, ''),
      'box width',
    ],
    [
      'a label on one line',
      375,
      (h) => h.replace(/class="aee-stack" /g, '').replace(/white-space: nowrap; /g, ''),
      'link "BUY NOW" wraps',
    ],
    [
      'a nav link without its underline',
      600,
      (h) => h.replace(/ text-decoration: none;/g, ''),
      'underline',
    ],
  ];
  for (const [what, width, undo, kind] of undone) {
    it(`sees ${what} undone`, { timeout: 30_000 }, async () => {
      const broken = undo(imported(racoon));
      expect(broken).not.toBe(imported(racoon));
      const found = await importDifferences(reference(racoon), broken, width);
      expect(found.some((f) => f.startsWith(kind))).toBe(true);
    });
  }
});
