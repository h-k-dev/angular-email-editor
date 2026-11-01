/**
 * The editor draws a whole email document as a mail client does — in real
 * Chromium, `npm run test:render` (jsdom has no layout). The library keeps
 * the markup verbatim; the pixels around it are this app's (styles.scss):
 * the document's own type reset, `white-space`, and the caret aids
 * ProseMirror puts beside inline atoms, hidden off the caret's line.
 *
 * The seed is the catalogue's "New device sign-in", modelled on a real
 * notification email that came out taller and shifted in the designer:
 * its width comes from head CSS on a classed div, its detail rows hold 16px
 * icons in cells that shrink to their content, lines end in `<br>`, and a
 * long footer wraps beside links. Every line of text must stand where the
 * original puts it.
 */
import {
  convertAuthoredPageToStylesheet,
  createEditor,
  Editor,
  emailExtensions,
} from '@h-k-dev/angular-email-editor';

import newSignIn from '../../../../../../../public/examples/angularjs/new-sign-in.html' with {
  loader: 'text',
};

/** Desktop, and a phone. */
const WIDTHS = [600, 375];

interface Line {
  text: string;
  x: number;
  y: number;
}

/** Where each line of each text run starts, relative to the first. The
    editor's own controls (a table's + pills) are not the email's text; a
    space kept hanging at a line's end is a box of its own on that line, and
    draws nothing. */
function linesOf(root: Element): Line[] {
  const lines: Line[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
    if (!text || node.parentElement?.closest('.aee-add-pill')) continue;
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(node);
    const starts = new Map<number, number>();
    for (const rect of range.getClientRects()) {
      const top = Math.round(rect.top);
      if (rect.width && !starts.has(top)) starts.set(top, rect.left);
    }
    for (const [y, x] of starts) lines.push({ text: text.slice(0, 24), x, y });
  }
  const [first] = lines;
  return lines.map((line) => ({
    text: line.text,
    x: Math.round(line.x - first.x),
    y: Math.round(line.y - first.y),
  }));
}

/** The email as a mail client lays it out. */
async function original(html: string, width: number): Promise<Line[]> {
  const frame = document.createElement('iframe');
  frame.style.cssText = `position: absolute; left: 0; top: 0; border: 0; width: ${width}px; height: 4000px;`;
  const loaded = new Promise((resolve) => (frame.onload = resolve));
  frame.srcdoc = html;
  document.body.append(frame);
  await loaded;
  try {
    return linesOf(frame.contentDocument!.body);
  } finally {
    frame.remove();
  }
}

/** The left edge of the first line of text, px from the window's. */
function firstLeft(root: Element): number {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.nodeValue ?? '').trim()) continue;
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(node);
    const rect = Array.from(range.getClientRects()).find((r) => r.width);
    if (rect) return rect.left;
  }
  return NaN;
}

/** {@link firstLeft} of the email as a mail client lays it out. */
async function originalLeft(html: string, width: number): Promise<number> {
  const frame = document.createElement('iframe');
  frame.style.cssText = `position: absolute; left: 0; top: 0; border: 0; width: ${width}px; height: 4000px;`;
  const loaded = new Promise((resolve) => (frame.onload = resolve));
  frame.srcdoc = html;
  document.body.append(frame);
  await loaded;
  try {
    return Math.round(firstLeft(frame.contentDocument!.body));
  } finally {
    frame.remove();
  }
}

describe('A whole email document in the editor (render)', () => {
  let host: HTMLElement;
  let editor: Editor;
  let extra: HTMLStyleElement | null = null;

  const open = (html: string, width: number) => {
    host = document.createElement('div');
    host.style.cssText = `position: absolute; left: 0; top: 0; width: ${width}px;`;
    document.body.append(host);
    editor = createEditor({ parent: host, extensions: emailExtensions, content: html });
    return editor.view.dom;
  };

  /** Styles laid over the app's, to undo one of its rules. */
  const override = (css: string) => {
    extra = document.createElement('style');
    extra.textContent = css;
    document.head.append(extra);
  };

  const differences = async (html: string, width: number) => {
    const want = await original(html, width);
    const got = linesOf(open(html, width));
    const found: string[] = [];
    if (want.length !== got.length) found.push(`lines: ${want.length} → ${got.length}`);
    want.forEach((line, i) => {
      const other = got[i];
      if (!other || Math.abs(line.x - other.x) > 1 || Math.abs(line.y - other.y) > 1)
        found.push(`${JSON.stringify(line)} → ${JSON.stringify(other ?? null)}`);
    });
    return found;
  };

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    extra?.remove();
    extra = null;
  });

  it('is drawn as a document, with the app’s styles', () => {
    const view = open(newSignIn, 600);
    expect(view.classList).toContain('aee-document');
    expect(getComputedStyle(view).whiteSpace).toBe('pre-wrap');
  });

  for (const width of WIDTHS) {
    it(`lays out every line as the original at ${width}px`, async () => {
      expect(await differences(newSignIn, width)).toEqual([]);
    });
  }

  // Turned into a Stylesheet page of ours (the page grip's card), the
  // editor draws the page from its layout — the column, its runs' side
  // room, the room the author's table left round it — where the email's
  // head rule drew it: every line where it was.
  it('lays out every line as the original once it is a Stylesheet page', async () => {
    const want = await original(newSignIn, 720);
    const wantLeft = await originalLeft(newSignIn, 720);
    // The page draws itself against its surface (a container), as in the
    // composer.
    const surface = document.createElement('div');
    surface.className = 'email-compose__editor';
    surface.style.cssText = 'position: absolute; left: 0; top: 0; width: 720px;';
    document.body.append(surface);
    try {
      host = surface;
      editor = createEditor({ parent: surface, extensions: emailExtensions, content: newSignIn });
      expect(editor.exec(convertAuthoredPageToStylesheet(0))).toBe(true);
      expect(editor.view.dom.getAttribute('data-page-layout')).toBe('stylesheet');
      expect(linesOf(editor.view.dom)).toEqual(want);
      // …and where the column's side room puts the first of them.
      expect(Math.round(firstLeft(editor.view.dom))).toBe(wantLeft);
    } finally {
      surface.remove();
    }
  });

  // The harness itself: each rule the seed was made for, undone, moves it.
  it('sees the caret aids beside an icon in a cell that shrinks to it', async () => {
    override('.aee-editor img.ProseMirror-separator { display: inline !important; }');
    expect((await differences(newSignIn, 600)).length).toBeGreaterThan(0);
  });

  it('sees the break ProseMirror adds after a line-end <br>', async () => {
    override('.aee-editor br.ProseMirror-trailingBreak { display: inline !important; }');
    expect((await differences(newSignIn, 600)).length).toBeGreaterThan(0);
  });

  it('sees spaces kept at a line’s end (break-spaces)', async () => {
    override('.aee-editor.aee-document { white-space: break-spaces !important; }');
    expect((await differences(newSignIn, 600)).length).toBeGreaterThan(0);
  });
});
