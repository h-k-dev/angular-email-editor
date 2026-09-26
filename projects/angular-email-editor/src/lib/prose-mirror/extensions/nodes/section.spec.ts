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

  it('carries an image behind the band — attribute and CSS for Gmail, VML for Outlook, the fill beneath — and parses back as itself', () => {
    editor.commands['insertSection']('#202124');
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('hero'));
      return true;
    });
    expect(editor.commands['setSectionImage']('https://x.io/hero.jpg')).toBe(true);
    const out = editor.getHTML();
    expect(out).toContain(
      '<td bgcolor="#202124" background="https://x.io/hero.jpg" style="padding: 20px 0px; background-color: rgb(32, 33, 36); color: rgb(255, 255, 255); background-image: url(&quot;https://x.io/hero.jpg&quot;); background-position: center top; background-size: cover; background-repeat: no-repeat;">',
    );
    // Outlook's drawing, in the comments every other client discards —
    // round the content, the fill as the picture's base.
    expect(out).toContain(
      '<!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="mso-width-percent: 1000;"><v:fill type="frame" src="https://x.io/hero.jpg" color="#202124" /><v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text: true;"><![endif]--><div style="max-width: 600px;',
    );
    expect(out).toContain('hero</div></div><!--[if mso]></v:textbox></v:rect><![endif]--></td>');
    // The editor shows it too.
    expect(host.querySelector<HTMLElement>('.aee-section')!.style.backgroundImage).toContain(
      'https://x.io/hero.jpg',
    );
    // A fixpoint: the comments go on parse, the attribute brings the image
    // back, the emit writes the same comments.
    expect(canonical(out)).toBe(out);
    // Taken away, no trace — not a comment.
    editor.commands['setSectionImage'](null);
    expect(editor.getHTML()).not.toContain('<!--');
    expect(editor.getHTML()).not.toContain('background=');
  });

  it('takes only an http(s) image: a script, a data URL or a file is refused, on the command and on parse', () => {
    editor.commands['insertSection']('#202124');
    expect(editor.commands['setSectionImage']('javascript:alert(1)')).toBe(false);
    expect(editor.commands['setSectionImage']('data:image/png;base64,AAAA')).toBe(false);
    expect(editor.commands['setSectionImage']('file:///etc/hosts')).toBe(false);
    expect(editor.getHTML()).not.toContain('background=');
    const refused = canonical(
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>' +
        '<td background="javascript:alert(1)" style="padding: 20px 0px; background-image: url(data:image/png;base64,AAAA)"><div><p>x</p></div></td></tr></tbody></table>',
    );
    expect(refused).toContain('padding: 20px 0px;');
    expect(refused).not.toContain('background=');
    expect(refused).not.toContain('javascript');
  });

  it('parses MJML’s hero: the image on the wrapping div and as the table’s background', () => {
    const mjml =
      '<div style="background:url(\'https://static.x.io/hero.jpg\') center top / cover no-repeat;background-position:center top;background-repeat:no-repeat;background-size:cover;margin:0px auto;max-width:600px;">' +
      '<div style="line-height:0;font-size:0;">' +
      '<table align="center" background="https://static.x.io/hero.jpg" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:url(\'https://static.x.io/hero.jpg\') center top / cover no-repeat;width:100%;"><tbody><tr>' +
      '<td style="direction:ltr;font-size:0px;padding:20px 0;text-align:center;">' +
      '<div style="display:inline-block;vertical-align:top;width:100%;max-width:600px"><p>Are you seascape?</p></div>' +
      '</td></tr></tbody></table></div></div>';
    const out = canonical(mjml);
    expect(out).toContain('background="https://static.x.io/hero.jpg"');
    expect(out).toContain('<v:fill type="frame" src="https://static.x.io/hero.jpg" />');
    // The shorthand's colour is transparent — no fill, not black.
    expect(out).not.toContain('bgcolor=');
    expect(out).not.toContain('background-color');
    expect(out).toContain('Are you seascape?');
    expect(canonical(out)).toBe(out);
  });

  it('is not a filled cell round one anchor — that is a button’s box, MJML’s', () => {
    const out = canonical(
      '<table border="0" cellpadding="0" cellspacing="0" role="presentation"><tbody><tr>' +
        '<td align="center" bgcolor="#48b6bf" role="presentation" style="background:#48b6bf;border-radius:3px" valign="middle">' +
        '<a href="https://x.io" style="display: inline-block; background: #48b6bf; color: #FFFFFF; padding: 10px 25px;">BOOK NOW</a>' +
        '</td></tr></tbody></table>',
    );
    expect(out).not.toContain('max-width: 600px');
    expect(out).not.toContain('bgcolor=');
    expect(out).toContain('background-color: rgb(72, 182, 191);');
    expect(out).toContain('>BOOK NOW</a>');
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
