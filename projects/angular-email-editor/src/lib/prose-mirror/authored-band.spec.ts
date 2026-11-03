import { undo } from 'prosemirror-history';
import { Node } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from './editor';
import { emailExtensions } from './extensions/kits';
import { createColumnHandles } from './extensions/column-handles';
import { createSectionHandles, SectionHandleTarget } from './extensions/section-handles';
import { parseHTML, serializeToHTML } from './html';
import {
  authoredBand,
  authoredBandPositions,
  authoredColumns,
  convertAuthoredBand,
  convertAuthoredBands,
  convertAuthoredColumns,
} from './authored-band';
import { authoredPageBands, convertAuthoredPageToCentred } from './authored-page';
import { normalizePageLayout } from './page-layout';
import { createSchema } from './schema';

const fs = (globalThis as any).process.getBuiltinModule('fs');
const DIR = 'projects/app/public/examples/mjml';
const read = (name: string) => fs.readFileSync(`${DIR}/${name}`, 'utf8') as string;
/** MJML's Racoon: a header of logo and links in two columns, a hero of two
    (200px and 400px), and rows of three products. */
const RACOON = read('racoon.html');
const EXAMPLES: string[] = fs.readdirSync(DIR).filter((name: string) => name.endsWith('.html'));

const schema = createSchema(emailExtensions);

/** Every node of a kind, in document order, with its position. */
const nodesOf = (doc: Node, name: string) => {
  const found: { node: Node; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === name) found.push({ node, pos });
  });
  return found;
};

/** A converted document as the email says it, read back: the same. */
const readsBack = (doc: Node) => {
  const html = serializeToHTML(doc, schema);
  return serializeToHTML(parseHTML(html, schema), schema) === html;
};

/** The state after a command, or null where it declines. */
function after(doc: Node, command: ReturnType<typeof convertAuthoredBands>): EditorState | null {
  let state = EditorState.create({ doc });
  return command(state, (tr) => (state = state.apply(tr))) ? state : null;
}

/** The inner HTML an element of the email holds, its whitespace aside. */
const inner = (html: string, select: (doc: Document) => Element[]) =>
  select(new DOMParser().parseFromString(html, 'text/html')).map((el) =>
    el.innerHTML.replace(/\s+/g, ' ').trim(),
  );

describe('an MJML band — offered as a section of ours, with its columns', () => {
  let host: HTMLElement;
  let editor: Editor;

  const mount = (content: string, extensions = emailExtensions) => {
    editor?.destroy();
    editor = createEditor({ parent: host, extensions, content });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor?.destroy();
    host.remove();
  });

  it('converts nothing on parse: every band is kept as written', () => {
    for (const name of EXAMPLES) {
      const doc = parseHTML(read(name), schema);
      expect(nodesOf(doc, 'section'), name).toEqual([]);
      expect(nodesOf(doc, 'columns'), name).toEqual([]);
    }
  });

  it('recognises Racoon’s bands: the header’s two columns, the hero’s 200 and 400px, the products’ three', () => {
    const doc = parseHTML(RACOON, schema);
    const bands = authoredBandPositions(doc).map((pos) => authoredBand(doc.nodeAt(pos)!)!);
    // Eleven of its twelve: the last holds no columns of MJML's.
    expect(bands).toHaveLength(11);
    expect(bands.every((band) => band.convertible)).toBe(true);
    const [header, hero, , products] = bands;
    expect(header.section).toEqual({ fill: '#ffffff', width: 600, top: 20, bottom: 20, inset: 0 });
    expect(header.columns.map((column) => column.percent)).toEqual([50, 50]);
    expect(hero.section).toEqual({ fill: '#fa8739', width: 600, top: 0, bottom: 0, inset: 0 });
    expect(hero.columns.map((column) => Math.round(column.percent))).toEqual([33, 67]);
    expect(products.columns).toHaveLength(3);
    expect(products.columns.every((column) => column.valign === 'bottom')).toBe(true);
  });

  it('converted: the hero a section of two columns, the content as written, the ghost table gone — one undo step', () => {
    mount(RACOON);
    const before = editor.getHTML();
    const hero = authoredBandPositions(editor.state.doc)[1];
    expect(editor.exec(convertAuthoredBand(hero))).toBe(true);

    const [section] = nodesOf(editor.state.doc, 'section');
    expect(section.pos).toBe(hero);
    // A card of the band's orange, 600px, on the wrapper's grey round it.
    expect(section.node.attrs).toMatchObject({
      background: '#d6dde5',
      contentBackground: '#fa8739',
      width: 600,
      inset: 0,
      image: null,
    });
    const columns = section.node.child(0);
    expect(columns.type.name).toBe('columns');
    const caps = [columns.child(0).attrs['maxWidth'], columns.child(1).attrs['maxWidth']];
    // MJML's own widths: a third and two of the 600px band.
    expect(caps).toEqual([200, 400]);

    const html = editor.getHTML();
    // Each column holds what MJML's held, exactly.
    const mjml = (doc: Document) =>
      Array.from(doc.querySelectorAll('.mj-column-px-200, .mj-column-px-400'));
    const ours = (doc: Document) =>
      Array.from(doc.querySelectorAll('.aee-layout-section .aee-layout-column'));
    expect(inner(html, ours)).toEqual(inner(before, mjml));
    // Outlook's ghost table round the band went with it: the comment above
    // still closes the header's, the one below still opens the next band's.
    expect(html).not.toContain('class="mj-column-px-200');
    const ghosts = (source: string, fill: string) =>
      source.split(`<table align="center"`).filter((part) => part.includes(`bgcolor="${fill}"`))
        .length;
    expect(ghosts(html, '#fa8739')).toBe(ghosts(before, '#fa8739') - 1);
    expect(ghosts(html, '#2f323b')).toBe(ghosts(before, '#2f323b'));
    expect(readsBack(editor.state.doc)).toBe(true);

    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).toBe(before);
  });

  it('gives the hero’s columns a working grip', () => {
    const opened: unknown[] = [];
    mount(RACOON, [...emailExtensions, createColumnHandles({ onOpen: (t) => opened.push(t) })]);
    editor.exec(convertAuthoredBand(authoredBandPositions(editor.state.doc)[1]));
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text!.includes('SPRING PROMO')) at = pos;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at + 1)),
    );
    const grip = editor.view.dom.querySelector<HTMLElement>('.aee-grip--layout-column')!;
    expect(grip.getAttribute('aria-label')).toBe('Column 1 options');
    grip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const target = opened[0] as { columnPos: number };
    expect(editor.state.doc.nodeAt(target.columnPos)?.type.name).toBe('column');
    // Its menu's commands act on it.
    expect(editor.commands['setColumnVerticalAlign']('middle')).toBe(true);
    expect(editor.state.doc.nodeAt(target.columnPos)?.attrs['valign']).toBe('middle');
  });

  it('puts a grip on every band that converts, whose press names it', () => {
    const opened: (SectionHandleTarget | null)[] = [];
    mount(RACOON, [...emailExtensions, createSectionHandles({ onOpen: (t) => opened.push(t) })]);
    const grips = editor.view.dom.querySelectorAll<HTMLElement>('.aee-grip--band');
    expect(grips).toHaveLength(11);
    grips[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(opened[0]).toMatchObject({
      kind: 'band',
      sectionPos: authoredBandPositions(editor.state.doc)[1],
    });
    // Converted, the band is ours: a section's grip, no band's.
    editor.exec(convertAuthoredBand(opened[0]!.sectionPos));
    expect(editor.view.dom.querySelectorAll('.aee-grip--band')).toHaveLength(10);
    expect(editor.view.dom.querySelectorAll('.aee-grip--section')).toHaveLength(1);
  });

  it('converts every band at once — one undo step', () => {
    mount(RACOON);
    const before = editor.getHTML();
    expect(editor.exec(convertAuthoredBands())).toBe(true);
    expect(nodesOf(editor.state.doc, 'section')).toHaveLength(11);
    expect(authoredBandPositions(editor.state.doc)).toEqual([]);
    expect(editor.exec(convertAuthoredBands())).toBe(false);
    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).toBe(before);
  });

  it('keeps the page offered as a centred one after a band converts', () => {
    const doc = parseHTML(RACOON, schema);
    const state = after(doc, convertAuthoredBand(authoredBandPositions(doc)[1]))!;
    expect(authoredPageBands(state.doc.child(0), schema)?.shape).toBe('centred-bands');
  });

  it('converts the centred page and its bands in one step: each band the page’s own width', () => {
    mount(RACOON);
    const before = editor.getHTML();
    expect(editor.exec(convertAuthoredPageToCentred(0, { bands: true }))).toBe(true);
    expect(normalizePageLayout(editor.state.doc.attrs['pageLayout'])?.width).toBe(600);
    const sections = nodesOf(editor.state.doc, 'section');
    expect(sections).toHaveLength(11);
    // Centred by the page now: the band's fill is the band's, its width
    // the page's.
    expect(sections[1].node.attrs).toMatchObject({
      background: '#fa8739',
      contentBackground: null,
      width: 600,
    });
    expect(readsBack(editor.state.doc)).toBe(true);
    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).toBe(before);
  });

  it('converts the bands of a centred page afterwards too', () => {
    mount(RACOON);
    editor.exec(convertAuthoredPageToCentred(0));
    expect(editor.exec(convertAuthoredBands())).toBe(true);
    expect(nodesOf(editor.state.doc, 'section')).toHaveLength(11);
    expect(readsBack(editor.state.doc)).toBe(true);
  });

  for (const name of EXAMPLES) {
    it(
      `${name}: every band converts alone and all together, reads back as converted, words and links as written`,
      { timeout: 20_000 },
      () => {
        const html = read(name);
        const doc = parseHTML(html, schema);
        const positions = authoredBandPositions(doc);
        expect(positions.length).toBeGreaterThan(0);
        // Alone, beside bands still as written (read back once: a whole
        // email is a slow parse).
        const alone = positions.filter((pos) => authoredBand(doc.nodeAt(pos)!)!.convertible);
        for (const [index, pos] of alone.entries()) {
          const state = after(doc, convertAuthoredBand(pos))!;
          expect(state, `${name} @${pos}`).not.toBeNull();
          expect(state.doc.textContent).toBe(doc.textContent);
          if (index === 1) expect(readsBack(state.doc), `${name} @${pos}`).toBe(true);
        }
        const all = after(doc, convertAuthoredBands())!;
        expect(all).not.toBeNull();
        expect(all.doc.textContent).toBe(doc.textContent);
        expect(readsBack(all.doc)).toBe(true);
        const sections = nodesOf(parseHTML(serializeToHTML(all.doc, schema), schema), 'section');
        expect(sections.length).toBe(nodesOf(all.doc, 'section').length);
        // Every row of columns fits inside its band's side room: side by
        // side on a desktop, as MJML drew them.
        for (const { node } of nodesOf(all.doc, 'section')) {
          const row = node.attrs['width'] - 2 * node.attrs['inset'];
          for (const { node: block } of nodesOf(node, 'columns')) {
            let caps = 0;
            block.forEach((column) => (caps += column.attrs['maxWidth']));
            expect(caps, name).toBeLessThanOrEqual(row);
          }
        }
        const links = (source: string) =>
          Array.from(
            new DOMParser().parseFromString(source, 'text/html').querySelectorAll('a, img'),
          ).map((el) => el.getAttribute('href') ?? el.getAttribute('src'));
        expect(links(serializeToHTML(all.doc, schema))).toEqual(
          links(serializeToHTML(doc, schema)),
        );
      },
    );
  }

  it('keeps a band with corners as written, offering its columns alone', () => {
    // Food Delivery's hero: rounded, two columns.
    const doc = parseHTML(read('food-delivery.html'), schema);
    const pos = authoredBandPositions(doc).find((at) => {
      const band = authoredBand(doc.nodeAt(at)!)!;
      return !band.convertible && band.columnsConvertible;
    })!;
    expect(authoredBand(doc.nodeAt(pos)!)!.section).toBeNull();
    expect(after(doc, convertAuthoredBand(pos))).toBeNull();
    const state = after(doc, convertAuthoredColumns(pos))!;
    const band = state.doc.nodeAt(pos)!;
    expect(band.type.name).toBe('htmlElement');
    expect(nodesOf(band, 'columns')).toHaveLength(1);
    expect(serializeToHTML(state.doc, schema)).toContain('border-radius:8px');
    expect(state.doc.textContent).toBe(doc.textContent);
    expect(readsBack(state.doc)).toBe(true);
  });

  const band = (style: string, columns: string) =>
    `<div style="word-spacing:normal;background-color:#eeeeee;"><div style="${style}"><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;"><tbody><tr><td style="direction:ltr;font-size:0px;padding:20px 0;text-align:center;">${columns}</td></tr></tbody></table></div></div>`;
  const column = (share: string, extra = '') =>
    `<div class="mj-column-${share} mj-outlook-group-fix${extra}" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"><tbody><tr><td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"><div style="font-family:Arial;font-size:13px;line-height:1;text-align:left;color:#000000;">Words</div></td></tr></tbody></table></div>`;
  const centred = 'background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;';
  const bandOf = (html: string) => {
    const doc = parseHTML(html, schema);
    const [pos] = authoredBandPositions(doc);
    return pos === undefined ? null : authoredBand(doc.nodeAt(pos)!);
  };

  it('reads a band’s px columns as their share of its content', () => {
    expect(bandOf(band(centred, column('px-150') + column('px-450')))?.columns).toEqual([
      { percent: 25, valign: 'top' },
      { percent: 75, valign: 'top' },
    ]);
    const doc = parseHTML(band(centred, column('per-50') + column('per-50')), schema);
    const cell = doc.nodeAt(authoredBandPositions(doc)[0] + 4)!;
    expect(authoredColumns(cell)?.map((share) => share.percent)).toEqual([50, 50]);
  });

  for (const [what, html] of [
    [
      'a column with a class of the author’s',
      band(centred, column('per-50', ' promo') + column('per-50')),
    ],
    ['columns wider than a row', band(centred, column('per-100') + column('per-100'))],
    ['one column narrower than the band', band(centred, column('per-50'))],
    [
      'a band with a shadow',
      band(`${centred}box-shadow:0 0 4px #000;`, column('per-50') + column('per-50')),
    ],
    [
      'a band with a cap but no centring',
      band('max-width:600px;', column('per-50') + column('per-50')),
    ],
  ]) {
    it(`offers no section for ${what}`, () => {
      expect(bandOf(html)?.convertible ?? false).toBe(false);
    });
  }

  it('offers nothing for a band whose cell holds anything but MJML’s columns', () => {
    expect(bandOf(band(centred, '<p>Words</p>'))).toBeNull();
  });
});
