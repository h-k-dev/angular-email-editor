import { undo } from 'prosemirror-history';
import { Selection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { extensionSuggestions } from '../extension';
import { emailExtensions } from './kits';
import { centeredPageLayout, tablePageLayout } from '../page-layout';
import { isRowsPage, pageLayoutOf, setPageLayout } from './page-layout';
import { quotedHistory } from './quoted-history';
import { SuggestionMenuState, createSuggestionMenu } from './suggestion-menu';

const QUOTE = '<div>On Monday, Ada wrote:</div><blockquote>Shall we meet?</blockquote>';

describe('clear content', () => {
  let host: HTMLElement;
  let editor: Editor;

  const mount = (content: string) => {
    editor = createEditor({ parent: host, extensions: emailExtensions, content });
  };
  const action = () => editor.actions.find((a) => a.id === 'clear-content')!;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('clears everything written, in one step that Mod-Z takes back', () => {
    mount('<div>Dear Ada,</div><ul><li>one</li><li>two</li></ul><div><strong>Bye</strong></div>');
    const written = editor.getHTML();
    const empty = createEditor({ parent: host, extensions: emailExtensions });
    const blank = empty.getHTML();
    empty.destroy();

    expect(editor.commands['clearContent']()).toBe(true);
    expect(editor.getHTML()).toBe(blank);
    expect(editor.getText()).toBe('');
    expect(editor.state.selection.empty).toBe(true);

    expect(editor.exec(undo)).toBe(true);
    expect(editor.getHTML()).toBe(written);
  });

  it('leaves the quoted history where it is — only the written content goes', () => {
    mount('<div>My answer.</div>');
    editor.setQuoted(QUOTE);
    const quoted = quotedHistory(editor.state);
    expect(quoted).not.toBeNull();

    editor.commands['clearContent']();
    expect(editor.getText()).toBe('');
    expect(quotedHistory(editor.state)).toBe(quoted);
  });

  it('takes the page with it — rows, column and colours — and Mod-Z brings both back', () => {
    mount('<div>Dear Ada,</div>');
    editor.exec(setPageLayout(tablePageLayout({ background: '#f4f4f4' })));
    const written = editor.getHTML();
    expect(isRowsPage(editor.state)).toBe(true);

    expect(editor.commands['clearContent']()).toBe(true);
    expect(pageLayoutOf(editor.state)).toBeNull();
    expect(editor.state.doc.eq(editor.state.schema.topNodeType.createAndFill()!)).toBe(true);

    expect(editor.exec(undo)).toBe(true);
    expect(editor.getHTML()).toBe(written);
  });

  it('clears a page with nothing written in it', () => {
    mount('');
    editor.exec(setPageLayout(centeredPageLayout()));
    expect(action().isEnabled?.(editor.state)).toBe(true);

    expect(editor.commands['clearContent']()).toBe(true);
    expect(pageLayoutOf(editor.state)).toBeNull();
    expect(action().isEnabled?.(editor.state)).toBe(false);
  });

  it('leaves the envelope as it was', () => {
    mount(
      '<!doctype html><html lang="en"><head><title>Hello</title></head>' +
        '<body class="mail"><div>Dear Ada,</div></body></html>',
    );
    editor.exec(setPageLayout(centeredPageLayout()));
    const envelope = editor.state.doc.attrs['envelope'];
    expect(envelope).not.toBeNull();

    editor.commands['clearContent']();
    expect(editor.state.doc.attrs['envelope']).toEqual(envelope);
    expect(pageLayoutOf(editor.state)).toBeNull();
  });

  it('has nothing to do on an empty message, and says so', () => {
    mount('');
    expect(action().isEnabled?.(editor.state)).toBe(false);
    expect(editor.commands['clearContent']()).toBe(false);
  });

  it('is the /clear row of a message with something written', () => {
    let state: SuggestionMenuState | undefined;
    const menu = document.createElement('div');
    host.appendChild(menu);
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createSuggestionMenu({
          trigger: '/',
          element: menu,
          items: extensionSuggestions,
          onChange: (s) => (state = s),
        }),
      ],
      content: '<div>Dear Ada,</div><div></div>',
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    document.elementFromPoint ??= () => null;
    editor.exec((s, dispatch) => {
      dispatch?.(s.tr.setSelection(Selection.atEnd(s.doc)));
      return true;
    });
    editor.exec((s, dispatch) => {
      dispatch?.(s.tr.insertText('/clear'));
      return true;
    });
    expect(state?.items.map((item) => item.id)).toEqual(['clear-content']);

    state?.select(state.items[0]);
    expect(editor.getText()).toBe('');
  });
});
