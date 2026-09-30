import { undo } from 'prosemirror-history';
import { AllSelection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createEditor } from '../editor';
import { formatHTML } from '../html-source';
import { htmlSourceExtensions } from './kits';
import { scanMergeTags } from './nodes/merge-tag';
import { TYPING_REST, createHtmlLanguage } from './html-language';

/** A paste as the browser delivers it — jsdom has no ClipboardEvent, so a
    plain event carrying the clipboard; ProseMirror's own paste path takes it. */
function paste(view: EditorView, text: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : ''), types: ['text/plain'], files: [] },
  });
  view.dom.dispatchEvent(event);
}

describe('html-language — format on paste', () => {
  // As the MJML playground hands a template over: one attribute a line, the
  // style never split — and wide enough that ours breaks it at its `;`.
  const PASTED = [
    '<div',
    '  style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;"',
    '>',
    '<p>Happy New Year</p>',
    '</div>',
  ].join('\n');

  let host: HTMLElement;
  const mount = (content = '') => {
    host = document.createElement('div');
    document.body.appendChild(host);
    return createEditor({ parent: host, extensions: htmlSourceExtensions, content });
  };
  afterEach(() => host.remove());

  it('formats a paste that is the whole document; one undo gives the paste back as it was', () => {
    const editor = mount();
    paste(editor.view, PASTED);
    expect(editor.getText()).toBe(formatHTML(PASTED, undefined, undefined, { mode: 'email' }));
    expect(editor.getText()).toContain('    max-width:600px;\n');

    editor.exec(undo);
    expect(editor.getText()).toBe(PASTED);
    editor.destroy();
  });

  it('formats a paste over everything selected, a one-line minified template too', () => {
    const editor = mount();
    editor.setText('<div>old</div>');
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    paste(editor.view, '<div><p>one</p><p>two</p></div>');
    expect(editor.getText()).toBe('<div>\n  <p>one</p>\n  <p>two</p>\n</div>');
    editor.destroy();
  });

  it('leaves a paste into part of the document as pasted, and markup with errors alone', () => {
    const editor = mount();
    editor.setText('<div>\n  x\n</div>');
    // The caret after the x: a paste into the document, not in its place.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 11)));
    paste(editor.view, '<b>y</b>\n<i>z</i>');
    expect(editor.getText()).toContain('<b>y</b>\n<i>z</i>');

    const broken = mount();
    paste(broken.view, '<div>\n<p>unclosed\n</div>');
    expect(broken.getText()).toBe('<div>\n<p>unclosed\n</div>');
    editor.destroy();
    broken.destroy();
  });
});

describe('html-language — interpolation highlighting', () => {
  it('scanMergeTags finds each token and the expression inside it', () => {
    expect(scanMergeTags('Hi {{ firstName }} and {{cf_70|formatPrice}} {{#if x}}')).toEqual([
      { from: 3, to: 18, expr: [5, 16] },
      { from: 23, to: 44, expr: [25, 42] },
    ]);
  });

  it('while typing, moves its decorations along and rescans only once typing rests', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reports: unknown[] = [];
    const editor = createEditor({
      parent: host,
      extensions: [
        ...htmlSourceExtensions.filter((extension) => extension.name !== 'htmlLanguage'),
        createHtmlLanguage({ onDiagnostics: (d) => reports.push(d) }),
      ],
      content: '',
    });
    editor.setText('<div>Hi</div>');
    const scans = reports.length;
    const tags = () => [...editor.view.dom.querySelectorAll('.aee-tok-tag')].length;
    expect(tags()).toBe(2);

    // A burst of keystrokes inside the text: no rescan, highlighting kept.
    for (const char of 'there') {
      editor.view.dispatch(editor.state.tr.insertText(char, 8));
      vi.advanceTimersByTime(TYPING_REST / 5);
    }
    expect(reports.length).toBe(scans);
    expect(tags()).toBe(2);

    // Rest: one rescan, one report.
    vi.advanceTimersByTime(TYPING_REST);
    expect(reports.length).toBe(scans + 1);

    // A mirrored write rescans at once, however small its diff.
    editor.setText('<p>Hi</p>');
    expect(reports.length).toBe(scans + 2);

    vi.useRealTimers();
    editor.destroy();
    host.remove();
  });

  it('paints the braces muted and the expression set apart, Angular-template style', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor({ parent: host, extensions: htmlSourceExtensions, content: '' });
    editor.setText('<div>Hi {{ firstName }}, {{ cf_70 | formatPrice }}!</div>');
    const braces = [...editor.view.dom.querySelectorAll('.aee-tok-brace')].map(
      (el) => el.textContent,
    );
    const expressions = [...editor.view.dom.querySelectorAll('.aee-tok-expression')].map(
      (el) => el.textContent,
    );
    expect(braces).toEqual(['{{', '}}', '{{', '}}']);
    expect(expressions).toEqual([' firstName ', ' cf_70 | formatPrice ']);
    // A token the formatter wrapped over lines is still one token.
    editor.setText("<div>\n  {{\n    a == 'x' ? 'y' : 'z'\n  }}\n</div>");
    expect(
      [...editor.view.dom.querySelectorAll('.aee-tok-brace')].map((el) => el.textContent),
    ).toEqual(['{{', '}}']);
    expect(scanMergeTags('{{\n  a\n}}', { multiline: true })).toEqual([
      { from: 0, to: 9, expr: [2, 7] },
    ]);
    // Tag tokens keep their own classes; braces inside a tag are never tokens.
    editor.setText('<div title="{{ notAToken }}">x</div>');
    expect(editor.view.dom.querySelector('.aee-tok-brace')).toBeNull();
    editor.destroy();
    host.remove();
  });
});
