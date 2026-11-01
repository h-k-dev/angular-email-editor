import { TextSelection } from 'prosemirror-state';
import {
  createEditor,
  Editor,
  Extension,
  docText,
  htmlSourceExtensions,
} from '@h-k-dev/angular-email-editor';
import { createSourceFolding, foldRanges } from './source-folding';
import { createSourceGutter } from './source-gutter';
import { SourceSearchState, createSourceSearch } from './source-search';
import { createSourceKeys } from './source-keys';
import { createTagMatching, matchingTag } from './tag-matching';

const SOURCE = [
  '<table>', // 0
  '  <tr>', // 1
  '    <td>', // 2
  '      one', // 3
  '    </td>', // 4
  '  </tr>', // 5
  '</table>', // 6
  '<style>', // 7
  '  p {', // 8
  '    margin: 0;', // 9
  '  }', // 10
  '</style>', // 11
].join('\n');

describe('source tools (opt-in)', () => {
  let host: HTMLElement;
  let editor: Editor;
  let search: SourceSearchState | undefined;

  const mount = (extra: Extension[], text = SOURCE) => {
    editor = createEditor({ parent: host, extensions: [...extra, ...htmlSourceExtensions] });
    editor.setText(text);
  };
  /** The position at a line's start + column. */
  const at = (line: number, column = 0) => {
    let pos = 0;
    editor.state.doc.forEach((_, offset, index) => {
      if (index === line) pos = offset + 1 + column;
    });
    return pos;
  };
  const caret = (line: number, column = 0) =>
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at(line, column))),
    );
  const lines = () => [...host.querySelectorAll<HTMLElement>('.aee-code-line')];
  const hidden = () =>
    lines()
      .map((line, i) => (line.classList.contains('aee-code-line--hidden') ? i : -1))
      .filter((i) => i >= 0);

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    search = undefined;
  });

  afterEach(() => {
    editor?.destroy();
    host.remove();
  });

  it('turns spellcheck and autocorrect off in every source editor', () => {
    mount([]);
    expect(editor.view.dom.getAttribute('spellcheck')).toBe('false');
    expect(editor.view.dom.getAttribute('autocorrect')).toBe('off');
  });

  it('finds fold ranges: elements over several lines, CSS rules in <style>', () => {
    expect([...foldRanges(SOURCE)].sort(([a], [b]) => a - b)).toEqual([
      [0, 6],
      [1, 5],
      [2, 4],
      [7, 11],
      [8, 10],
    ]);
    // Open and close on neighbouring lines: nothing to hide.
    expect(foldRanges('<p>\n</p>').size).toBe(0);
  });

  it('marks the gutter and the caret’s line', () => {
    mount([createSourceGutter()]);
    expect(editor.view.dom.classList).toContain('aee-source-gutter');
    caret(3, 2);
    expect(lines()[3].classList).toContain('aee-code-line--active');
  });
  it('numbers every line, and numbers again when a line comes or goes — not while typing', () => {
    mount([createSourceGutter()], ['a', 'b', 'c'].join('\n'));
    const numbers = () => lines().map((line) => line.dataset['line']);
    expect(numbers()).toEqual(['1', '2', '3']);

    editor.view.dispatch(editor.state.tr.insertText('x', at(1, 1)));
    expect(numbers()).toEqual(['1', '2', '3']);

    editor.view.dispatch(editor.state.tr.split(at(0, 1)));
    expect(numbers()).toEqual(['1', '2', '3', '4']);

    editor.view.dispatch(editor.state.tr.delete(at(0, 1), at(1, 0)));
    expect(numbers()).toEqual(['1', '2', '3']);
  });

  it('folds and unfolds by command, the caret kept out of hidden lines', () => {
    mount([createSourceFolding()]);
    caret(3, 2);
    expect(editor.commands['fold']()).toBe(true);
    expect(hidden()).toEqual([3]);
    // The caret was inside: it moved to the folded line's end.
    expect(editor.state.selection.head).toBe(at(2, '    <td>'.length));
    expect(host.querySelector('.aee-fold-placeholder')).not.toBeNull();

    editor.commands['unfold']();
    expect(hidden()).toEqual([]);
  });

  it('opens a fold when the caret or an edit reaches its hidden lines, never for typing on its ends', () => {
    mount([createSourceFolding()]);
    caret(0);
    editor.commands['fold']();
    expect(hidden()).toEqual([1, 2, 3, 4, 5]);

    editor.view.dispatch(editor.state.tr.insertText(' class="x"', at(0, 6)));
    expect(hidden()).toEqual([1, 2, 3, 4, 5]);

    caret(3, 1);
    expect(hidden()).toEqual([]);
  });

  it('highlights the partner of the tag the caret is on', () => {
    const text = '<div>\n  <div></div>\n</div>';
    expect(matchingTag(text, 2)).toEqual([
      [1, 4],
      [22, 25],
    ]);
    expect(matchingTag(text, 23)).toEqual([
      [1, 4],
      [22, 25],
    ]);
    mount([createTagMatching()], text);
    caret(0, 2);
    expect(host.querySelectorAll('.aee-tag-match').length).toBe(2);
  });

  it('searches, steps and replaces — regexp groups too', () => {
    mount([createSourceSearch({ onChange: (state) => (search = state) })]);
    editor.commands['openSearch']();
    editor.commands['setSearchQuery']({ text: 'td' });
    expect(search?.count).toBe(2);
    expect(search?.current).toBe(0);
    expect(host.querySelectorAll('.aee-search-match--current').length).toBe(1);

    editor.commands['findNext']();
    expect(search?.current).toBe(1);

    editor.commands['setSearchQuery']({ text: '<(/?)td>', regexp: true });
    editor.commands['replaceAll']('<$1th>');
    expect(docText(editor.state.doc)).toContain('<th>');
    expect(docText(editor.state.doc)).toContain('</th>');
    expect(search?.count).toBe(0);

    editor.commands['closeSearch']();
    expect(search?.open).toBe(false);
    expect(host.querySelector('.aee-search-match')).toBeNull();
  });

  it('comments lines in and out — CSS comments inside <style>', () => {
    mount([createSourceKeys()]);
    caret(3, 2);
    editor.commands['toggleComment']();
    expect(docText(editor.state.doc).split('\n')[3]).toBe('      <!-- one -->');
    editor.commands['toggleComment']();
    expect(docText(editor.state.doc).split('\n')[3]).toBe('      one');

    caret(9, 4);
    editor.commands['toggleComment']();
    expect(docText(editor.state.doc).split('\n')[9]).toBe('    /* margin: 0; */');
  });

  it('moves, copies and deletes lines', () => {
    mount([createSourceKeys()], 'a\nb\nc');
    caret(1);
    editor.commands['moveLinesUp']();
    expect(docText(editor.state.doc)).toBe('b\na\nc');
    expect(editor.state.selection.$head.index(0)).toBe(0);

    editor.commands['copyLinesDown']();
    expect(docText(editor.state.doc)).toBe('b\nb\na\nc');
    expect(editor.state.selection.$head.index(0)).toBe(1);

    editor.commands['deleteLines']();
    expect(docText(editor.state.doc)).toBe('b\na\nc');
  });
});
