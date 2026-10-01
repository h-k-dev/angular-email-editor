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
import worldly from '../../../../app/public/examples/mjml/worldly.html' with { loader: 'text' };

const EXAMPLES: Record<string, string> = {
  'appointment-alert': appointmentAlert,
  arturia,
  austin,
  card,
  'food-delivery': foodDelivery,
  'happy-new-year': happyNewYear,
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
  await Promise.race([
    Promise.all(
      images.map((img) =>
        img.complete ? null : new Promise((done) => (img.onload = img.onerror = done)),
      ),
    ),
    new Promise((done) => setTimeout(done, IMAGE_WAIT)),
  ]);
  return frame;
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
  const [a, b] = await Promise.all([render(source, width), render(result, width)]);
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
