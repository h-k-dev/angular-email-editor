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

  it('round-trips HTML', () => {
    const html =
      '<p>Hello <strong>bold</strong> <em>italic</em> <u>underlined</u></p>' +
      '<blockquote><p>quoted<br>line</p></blockquote>' +
      '<h2>Title</h2>' +
      '<p><a href="https://example.com" title="Example">link</a></p>';
    const doc = parseHTML(html, schema);
    expect(serializeToHTML(doc, schema)).toBe(
      '<p dir="auto">Hello <strong style="font-weight: bold;">bold</strong> <em style="font-style: italic;">italic</em> <u style="text-decoration: underline;">underlined</u></p>' +
        '<blockquote><p dir="auto">quoted<br>line</p></blockquote>' +
        '<h2>Title</h2>' +
        '<p dir="auto"><a href="https://example.com" title="Example" target="_blank" rel="noopener noreferrer">link</a></p>',
    );
  });

  it('normalizes messy email markup on parse', () => {
    const doc = parseHTML(
      '<p><span style="font-weight:700">bold</span> <b style="font-weight:normal">not bold</b></p>',
      schema,
    );
    expect(serializeToHTML(doc, schema)).toBe(
      '<p dir="auto"><strong style="font-weight: bold;">bold</strong> not bold</p>',
    );
  });

  it('toggleBold applies and removes bold on the selection', () => {
    let state = stateFromHTML('<p>Hello</p>', 1, 6);
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
    expect(serializeToHTML(state.doc, schema)).toBe('<h3>Title</h3>');
  });

  it('wrapInBlockquote wraps the current block', () => {
    let state = stateFromHTML('<p>quote me</p>', 1, 1);
    state = runCommand(state, 'blockquote', 'wrapInBlockquote');
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<blockquote><p dir="auto">quote me</p></blockquote>',
    );
  });

  it('round-trips lists', () => {
    const html =
      '<ul><li><p>one</p></li><li><p>two</p></li></ul>' +
      '<ol start="3"><li><p>three</p></li></ol>';
    expect(serializeToHTML(parseHTML(html, schema), schema)).toBe(
      '<ul><li><p dir="auto">one</p></li><li><p dir="auto">two</p></li></ul>' +
        '<ol start="3"><li><p dir="auto">three</p></li></ol>',
    );
  });

  it('toggleBulletList wraps and unwraps a paragraph', () => {
    let state = stateFromHTML('<p>item</p>', 1, 1);
    state = runCommand(state, 'bulletList', 'toggleBulletList');
    expect(serializeToHTML(state.doc, schema)).toBe('<ul><li><p dir="auto">item</p></li></ul>');
    state = runCommand(state, 'bulletList', 'toggleBulletList');
    expect(serializeToHTML(state.doc, schema)).toBe('<p dir="auto">item</p>');
  });

  it('toggleOrderedList converts a bullet list in place', () => {
    let state = stateFromHTML('<ul><li><p>item</p></li></ul>', 3, 3);
    state = runCommand(state, 'orderedList', 'toggleOrderedList');
    expect(serializeToHTML(state.doc, schema)).toBe('<ol><li><p dir="auto">item</p></li></ol>');
  });

  it('isNodeActive sees wrapper ancestors like blockquote and lists', () => {
    const state = stateFromHTML('<blockquote><p>quoted</p></blockquote>', 2, 2);
    expect(isNodeActive(state, schema.nodes['blockquote'])).toBe(true);
    expect(isNodeActive(state, schema.nodes['bulletList'])).toBe(false);
  });

  it('insertImage replaces the selection with an image block', () => {
    let state = stateFromHTML('<p>before</p>', 1, 7);
    state = runCommand(state, 'image', 'insertImage', { src: 'cid:logo', alt: 'Logo' });
    // Hybrid sizing: without a known width, images serialize fluid-capped.
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<img src="cid:logo" alt="Logo" style="max-width: 100%; height: auto;">',
    );
  });

  it('setLink and unsetLink manage the link mark', () => {
    let state = stateFromHTML('<p>click here</p>', 1, 11);
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
    const doc = parseHTML('<p>line one</p><p></p><p>line two</p>', emailSchema);
    expect(serializeToHTML(doc, emailSchema)).toBe(
      '<div>line one</div><div><br></div><div>line two</div>',
    );
  });

  it('parses inline-content divs as lines but descends into container divs', () => {
    const doc = parseHTML('<div><div>a</div><div><b>b</b></div></div>', emailSchema);
    expect(serializeToHTML(doc, emailSchema)).toBe(
      '<div>a</div><div><strong style="font-weight: bold;">b</strong></div>',
    );
  });

  it('round-trips content between the kits via HTML (for kit switching)', () => {
    const emailDoc = parseHTML('<div>one</div><div><br></div><div>two</div>', emailSchema);
    const emitted = serializeToHTML(emailDoc, emailSchema);

    // Hand the email output to the semantic kit: div lines become paragraphs.
    const richDoc = parseHTML(emitted, schema);
    expect(serializeToHTML(richDoc, schema)).toBe(
      '<p dir="auto">one</p><p dir="auto"><br></p><p dir="auto">two</p>',
    );

    // And back: paragraphs become div lines again.
    const backDoc = parseHTML(serializeToHTML(richDoc, schema), emailSchema);
    expect(serializeToHTML(backDoc, emailSchema)).toBe(
      '<div>one</div><div><br></div><div>two</div>',
    );
  });

  it('keeps the live editor view on plain divs (no br filler in toDOM)', () => {
    const paragraph = emailExtensions.find((e) => e.name === 'paragraph')!;
    expect(paragraph.type).toBe('node');
    const node = emailSchema.nodes['paragraph'].create();
    expect(emailSchema.nodes['paragraph'].spec.toDOM!(node)).toEqual(['div', { dir: 'auto' }, 0]);
  });
});
