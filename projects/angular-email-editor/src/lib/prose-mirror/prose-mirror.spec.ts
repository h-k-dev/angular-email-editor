import { EditorState, TextSelection } from 'prosemirror-state';
import { isNodeActive } from './editor';
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { emailExtensions, richTextExtensions } from './extensions/kits';
import { Extension } from './extension';

const schema = createSchema(richTextExtensions);

/** Runs a named extension command headlessly and returns the resulting state. */
function runCommand(state: EditorState, extensionName: string, command: string, ...args: any[]) {
  const extension = richTextExtensions.find((e) => e.name === extensionName) as Extension;
  const factories = extension.commands!({ schema, extensions: richTextExtensions });
  factories[command](...args)(state, (tr) => (state = state.apply(tr)));
  return state;
}

function stateFromHTML(html: string, from?: number, to?: number) {
  const doc = parseHTML(html, schema);
  return EditorState.create({
    doc,
    selection: from !== undefined ? TextSelection.create(doc, from, to) : undefined,
  });
}

describe('prose-mirror core', () => {
  it('builds a schema containing all node and mark extensions', () => {
    expect(Object.keys(schema.nodes)).toEqual(
      expect.arrayContaining(['doc', 'paragraph', 'text', 'hardBreak', 'heading', 'blockquote']),
    );
    expect(Object.keys(schema.marks)).toEqual(
      expect.arrayContaining(['bold', 'italic', 'underline', 'link']),
    );
  });

  it('throws when no top node is defined', () => {
    const withoutDoc = richTextExtensions.filter((e) => e.name !== 'doc');
    expect(() => createSchema(withoutDoc)).toThrowError(/top node/);
  });

  it('round-trips HTML as written', () => {
    const html =
      '<p>Hello <strong>bold</strong> <em>italic</em> <u>underlined</u></p>' +
      '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><p>quoted<br>line</p></blockquote>' +
      '<h2 class="aee-layout-heading" style="margin: 0px; font-size: 20px;">Title</h2>' +
      '<p><a href="https://example.com" title="Example">link</a></p>';
    const doc = parseHTML(html, schema);
    expect(serializeToHTML(doc, schema)).toBe(html);
  });

  it('keeps messy email markup as written on parse — a style never becomes a mark', () => {
    const html =
      '<p><span style="font-weight:700">bold</span> <b style="font-weight:normal">not bold</b></p>';
    expect(serializeToHTML(parseHTML(html, schema), schema)).toBe(html);
  });

  it('toggleBold applies and removes bold on the selection', () => {
    let state = stateFromHTML('<p dir="auto">Hello</p>', 1, 6);
    state = runCommand(state, 'bold', 'toggleBold');
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<p dir="auto"><strong style="font-weight: bold;">Hello</strong></p>',
    );
    state = runCommand(state, 'bold', 'toggleBold');
    expect(serializeToHTML(state.doc, schema)).toBe('<p dir="auto">Hello</p>');
  });

  it('setHeading converts a paragraph into a heading', () => {
    let state = stateFromHTML('<p>Title</p>', 1, 1);
    state = runCommand(state, 'heading', 'setHeading', 3);
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<h3 style="margin: 14px 0px 4px; font-size: 18px;">Title</h3>',
    );
  });

  it('wrapInBlockquote wraps the current block', () => {
    let state = stateFromHTML('<p dir="auto">quote me</p>', 1, 1);
    state = runCommand(state, 'blockquote', 'wrapInBlockquote');
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><p dir="auto">quote me</p></blockquote>',
    );
  });

  it('round-trips lists', () => {
    const html =
      '<ul class="aee-layout-list" style="margin: 0px; padding-left: 24px;"><li><p dir="auto">one</p></li><li><p dir="auto">two</p></li></ul>' +
      '<ol class="aee-layout-list" start="3" style="margin: 0px; padding-left: 24px;"><li><p dir="auto">three</p></li></ol>';
    const doc = parseHTML(html, schema);
    expect(doc.child(0).type.name).toBe('bulletList');
    expect(doc.child(1).type.name).toBe('orderedList');
    expect(doc.child(1).attrs['order']).toBe(3);
    expect(serializeToHTML(doc, schema)).toBe(html);
  });

  it('toggleBulletList wraps and unwraps a paragraph', () => {
    let state = stateFromHTML('<p dir="auto">item</p>', 1, 1);
    state = runCommand(state, 'bulletList', 'toggleBulletList');
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<ul style="margin: 12px 0px; padding-left: 24px;"><li><p dir="auto">item</p></li></ul>',
    );
    state = runCommand(state, 'bulletList', 'toggleBulletList');
    expect(serializeToHTML(state.doc, schema)).toBe('<p dir="auto">item</p>');
  });

  it('toggleOrderedList converts a bullet list in place', () => {
    let state = stateFromHTML(
      '<ul class="aee-layout-list" style="margin: 0px; padding-left: 24px;"><li><p dir="auto">item</p></li></ul>',
      3,
      3,
    );
    state = runCommand(state, 'orderedList', 'toggleOrderedList');
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<ol class="aee-layout-list" style="margin: 0px; padding-left: 24px;"><li><p dir="auto">item</p></li></ol>',
    );
  });

  it('isNodeActive sees wrapper ancestors like blockquote and lists', () => {
    const state = stateFromHTML(
      '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><p>quoted</p></blockquote>',
      2,
      2,
    );
    expect(isNodeActive(state, schema.nodes['blockquote'])).toBe(true);
    expect(isNodeActive(state, schema.nodes['bulletList'])).toBe(false);
  });

  it('insertImage replaces the selection with an inline image, in the line', () => {
    let state = stateFromHTML('<p dir="auto">before</p>', 1, 7);
    state = runCommand(state, 'image', 'insertImage', { src: 'cid:logo', alt: 'Logo' });
    // Hybrid sizing: without a known width, images serialize fluid-capped.
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<p dir="auto"><img src="cid:logo" alt="Logo" style="max-width: 100%; height: auto;"></p>',
    );
  });

  it('setLink and unsetLink manage the link mark', () => {
    let state = stateFromHTML('<p dir="auto">click here</p>', 1, 11);
    state = runCommand(state, 'link', 'setLink', { href: 'https://example.com' });
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<p dir="auto"><a href="https://example.com" target="_blank" rel="noopener noreferrer">click here</a></p>',
    );
    state = runCommand(state, 'link', 'unsetLink');
    expect(serializeToHTML(state.doc, schema)).toBe('<p dir="auto">click here</p>');
  });
});

describe('email kit', () => {
  const emailSchema = createSchema(emailExtensions);

  it('emits div lines instead of paragraphs, with br fillers for empty ones', () => {
    const line = emailSchema.nodes['paragraph'];
    const doc = emailSchema.nodes['doc'].create(null, [
      line.create(null, emailSchema.text('line one')),
      line.create(),
      line.create(null, emailSchema.text('line two')),
    ]);
    expect(serializeToHTML(doc, emailSchema)).toBe(
      '<div>line one</div><div><br></div><div>line two</div>',
    );
  });

  it('parses inline-content divs as lines but descends into container divs', () => {
    const html = '<div><div>a</div><div><b>b</b></div></div>';
    const doc = parseHTML(html, emailSchema);
    const container = doc.child(0);
    expect(container.childCount).toBe(2);
    expect(container.child(0).type.name).toBe('paragraph');
    expect(container.child(1).type.name).toBe('paragraph');
    expect(container.child(1).firstChild!.marks.map((m) => m.type.name)).toEqual(['bold']);
    // The container and the `<b>` stay as written.
    expect(serializeToHTML(doc, emailSchema)).toBe(html);
  });

  it('hands content between the kits as written (for kit switching)', () => {
    const emailDoc = parseHTML('<div>one</div><div><br></div><div>two</div>', emailSchema);
    const emitted = serializeToHTML(emailDoc, emailSchema);

    // The semantic kit keeps the email's div lines as written ...
    const richDoc = parseHTML(emitted, schema);
    expect(richDoc.textContent).toBe('onetwo');
    expect(serializeToHTML(richDoc, schema)).toBe(emitted);

    // ... so they come back to the email kit unchanged.
    const backDoc = parseHTML(serializeToHTML(richDoc, schema), emailSchema);
    expect(serializeToHTML(backDoc, emailSchema)).toBe(emitted);
  });

  it('keeps the live editor view on plain divs (no br filler in toDOM)', () => {
    const paragraph = emailExtensions.find((e) => e.name === 'paragraph')!;
    expect(paragraph.type).toBe('node');
    const node = emailSchema.nodes['paragraph'].create();
    expect(emailSchema.nodes['paragraph'].spec.toDOM!(node)).toEqual(['div', { dir: 'auto' }, 0]);
  });
});
