/**
 * Text metrics measuring for real — `npm run test:render`, in Chromium,
 * against the `@chenglou/pretext` the library declares (1.x): a canvas,
 * fonts, the browser's own line breaker.
 */
import { createEditor, emailExtensions, Editor } from '@h-k-dev/angular-email-editor';
import { TextMetrics, createTextMetrics, readTypography } from './public-api';

describe('text metrics (render)', () => {
  let host: HTMLElement;
  let editor: Editor | undefined;
  let metrics: TextMetrics[];
  let errors: unknown[];

  const mount = (content: string, style = 'width: 300px; font: 16px/24px sans-serif') => {
    host.setAttribute('style', style);
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createTextMetrics({
          onMetrics: (m) => metrics.push(m),
          onError: (error) => errors.push(error),
        }),
      ],
      content,
    });
    return metrics[metrics.length - 1];
  };

  /** The CSS ProseMirror requires of every host (prosemirror-view's
      style/prosemirror.css): spaces kept, lines wrapped. */
  let required: HTMLStyleElement;

  beforeAll(() => {
    required = document.createElement('style');
    required.textContent = '.ProseMirror { white-space: pre-wrap; word-wrap: break-word; }';
    document.head.appendChild(required);
  });

  afterAll(() => required.remove());

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    metrics = [];
    errors = [];
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    host.remove();
  });

  it('counts words, characters and lines of what is written', () => {
    const measured = mount('<div>Sehr geehrte Damen und Herren,</div><div><br></div><div>anbei.</div>');
    expect(errors).toEqual([]);
    expect(measured.words).toBe(6);
    expect(measured.characters).toBe('Sehr geehrte Damen und Herren,'.length + 'anbei.'.length);
    expect(measured.lines).toBe(3);
  });

  it('wraps a long line the way the browser does, and follows the text as it changes', () => {
    const long = 'Wort '.repeat(60).trim();
    const measured = mount(`<div>${long}</div>`);
    expect(measured.lines).toBeGreaterThan(1);

    const before = metrics.length;
    editor!.view.dispatch(editor!.state.tr.delete(1, editor!.state.doc.content.size - 1));
    expect(metrics.length).toBe(before + 1);
    expect(metrics[metrics.length - 1].lines).toBe(1);
  });

  it('an italic word changes no line break: the rich path wraps as pre-wrap, like the plain one', () => {
    // Double spaces are what pre-wrap keeps and `normal` collapses — typed
    // in, since parsing HTML would collapse them before any measurement.
    const text = ' ' + 'Wort    '.repeat(40).trim();
    const typed = (start: string) => {
      mount(`<div>${start}</div>`);
      editor!.view.dispatch(editor!.state.tr.insertText(text, editor!.state.doc.content.size - 1));
      return metrics[metrics.length - 1].lines;
    };
    const plain = typed('Wort');
    const plainDom = Math.round(host.querySelector<HTMLElement>('.ProseMirror > div')!.getBoundingClientRect().height / 24);
    editor!.destroy();
    metrics = [];
    // The italic word sends the block down the rich path; it must still break
    // where the editor breaks it — the real height of that very block.
    const rich = typed('<em>Wort</em>');
    const richDom = Math.round(host.querySelector<HTMLElement>('.ProseMirror > div')!.getBoundingClientRect().height / 24);
    expect(plain).toBe(plainDom);
    expect(rich).toBe(richDom);
    expect(rich).toBe(plain);
  });

  it('measures with the browser’s sans-serif when the editor has no font family', () => {
    const typography = readTypography(document.createElement('div'));
    expect(typography.fontFamily).not.toBe('');
    mount('<div>Hallo</div>', 'width: 300px; font-family: ;');
    expect(errors).toEqual([]);
    expect(metrics.length).toBeGreaterThan(0);
  });
});
