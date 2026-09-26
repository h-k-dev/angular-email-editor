import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../../editor';
import { emailExtensions } from '../kits';
import { parseHTML, serializeToHTML } from '../../html';
import { SECTION_PADDING } from './section';

describe('section', () => {
  let host: HTMLElement;
  let editor: Editor;

  const canonical = (html: string) =>
    serializeToHTML(parseHTML(html, editor.schema), editor.schema);
  const OURS =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody><tr>' +
    '<td bgcolor="#f1f3f4" style="padding: 20px 0px; background-color: rgb(241, 243, 244); color: rgb(32, 33, 36);">' +
    '<div style="max-width: 600px; margin-left: auto; margin-right: auto; padding-left: 16px; padding-right: 16px; box-sizing: border-box;"><div>band</div></div>' +
    '</td></tr></tbody></table>';

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: emailExtensions, content: '<p>before</p>' });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('emits one presentation table with the fill as bgcolor and inline style, the content centred — for Gmail and Outlook alike', () => {
    editor.commands['insertSection']('#f1f3f4');
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('band'));
      return true;
    });
    const out = editor.getHTML();
    expect(out).toContain(OURS);
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('<style');
    // A byte-stable fixpoint: the band parses back as itself.
    expect(canonical(out)).toBe(out);
  });

  it('is a section in the editor: a band with the layout guides’ hook, the fill on it', () => {
    editor.commands['insertSection']('#f1f3f4');
    const band = host.querySelector<HTMLElement>('.aee-section')!;
    expect(band.style.backgroundColor).toBe('rgb(241, 243, 244)');
    expect(band.style.padding).toBe(SECTION_PADDING);
    expect(band.querySelector<HTMLElement>('.aee-section__inner')?.style.maxWidth).toBe('600px');
    // The cursor landed inside.
    expect(editor.state.selection.$from.node(1).type.name).toBe('section');
  });

  it('fills and clears through the command, pairing the text colour; a band without a fill is a spacer', () => {
    editor.commands['insertSection']();
    expect(editor.getHTML()).toContain('<td style="padding: 20px 0px;">');
    editor.commands['setSectionBackground']('#202124');
    expect(editor.getHTML()).toContain(
      'bgcolor="#202124" style="padding: 20px 0px; background-color: rgb(32, 33, 36); color: rgb(255, 255, 255);"',
    );
    editor.commands['setSectionBackground'](null);
    expect(editor.getHTML()).toContain('<td style="padding: 20px 0px;">');
  });

  it('removeSection lifts the content out, where it stood', () => {
    editor.commands['insertSection']('#f1f3f4');
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('kept'));
      return true;
    });
    expect(editor.commands['removeSection']()).toBe(true);
    // The band stood at the caret, before the first line; its line stays there.
    expect(editor.getHTML()).toBe('<div>kept</div><div>before</div>');
  });

  it('parses a builder’s section: MJML’s fill on the wrapping div, padding on the cell, columns inside', () => {
    const mjml =
      '<div style="background:#354552;background-color:#354552;margin:0px auto;max-width:600px;">' +
      '<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#354552;width:100%;"><tbody><tr>' +
      '<td style="direction:ltr;font-size:0px;padding:20px 0;text-align:center;">' +
      '<div style="display:inline-block;vertical-align:top;width:100%;max-width:280px"><p>Left</p></div>' +
      '<div style="display:inline-block;vertical-align:top;width:100%;max-width:280px"><p>Right</p></div>' +
      '</td></tr></tbody></table></div>';
    const out = canonical(mjml);
    expect(out).toContain('bgcolor="#354552"');
    expect(out).toContain('background-color: rgb(53, 69, 82); color: rgb(255, 255, 255);');
    expect(out).toContain('padding: 20px 0px;');
    expect(out.match(/max-width: 280px/g)).toHaveLength(2);
    expect(canonical(out)).toBe(out);
  });

  it('leaves a one-cell table with words in it a table', () => {
    const table =
      '<table role="presentation" cellpadding="0" style="background-color: #f1f3f4"><tbody><tr><td style="padding: 8px">cell</td></tr></tbody></table>';
    const out = canonical(table);
    expect(out).not.toContain('max-width: 600px');
    expect(out).toContain('>cell</td>');
  });

  it('offers itself on the / menu, in the layout section', () => {
    const selection = TextSelection.create(editor.state.doc, 1);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    const action = emailExtensions
      .flatMap(
        (extension) =>
          extension.actions?.({ schema: editor.schema, extensions: emailExtensions }) ?? [],
      )
      .find((item) => item.id === 'section')!;
    expect(action.section).toBe('layout');
    expect(editor.exec(action.command)).toBe(true);
    expect(editor.getHTML()).toContain('bgcolor="#f1f3f4"');
  });
});
