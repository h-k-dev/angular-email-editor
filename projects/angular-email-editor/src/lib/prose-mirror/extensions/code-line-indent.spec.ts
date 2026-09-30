import { createEditor, Editor } from '../editor';
import { htmlSourceExtensions } from './kits';

describe('code line indent', () => {
  let host: HTMLElement;
  let editor: Editor;
  const indents = () =>
    [...host.querySelectorAll<HTMLElement>('.aee-code-line')].map(
      (line) => line.style.getPropertyValue('--aee-line-indent') || '0',
    );

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: htmlSourceExtensions });
    editor.setText('<div>\n  <p>\n    text\n  </p>\n</div>');
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('puts each line’s indentation on it, in characters — none on a line at the margin', () => {
    expect(indents()).toEqual(['0', '2', '4', '2', '0']);
  });

  it('follows an indent typed or deleted — only the line it happened on changes', () => {
    // Two spaces in front of the text line (position 1 of line 3).
    const lineStart = (index: number) => {
      let pos = 0;
      editor.state.doc.forEach((_, offset, i) => {
        if (i === index) pos = offset + 1;
      });
      return pos;
    };
    editor.view.dispatch(editor.state.tr.insertText('  ', lineStart(2)));
    expect(indents()).toEqual(['0', '2', '6', '2', '0']);

    editor.view.dispatch(editor.state.tr.delete(lineStart(1), lineStart(1) + 2));
    expect(indents()).toEqual(['0', '0', '6', '2', '0']);
  });

  it('keeps up with lines joined, split and replaced wholesale', () => {
    editor.setText('a\n        b');
    expect(indents()).toEqual(['0', '8']);
    editor.setText('    x');
    expect(indents()).toEqual(['4']);
  });
});
