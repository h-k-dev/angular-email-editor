import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { historyQuoteAt, isHistoryFolded } from './quote-fold';
import { replyDocument } from '../reply';

const SEED = replyDocument({ html: '<div>Original message</div>', from: 'Jane', date: 'Aug 18' });

describe('quote fold', () => {
  let host: HTMLElement;
  let editor: Editor;

  const toggle = () => host.querySelector<HTMLButtonElement>('button.aee-quote-fold');
  const quoteEl = () => host.querySelector<HTMLElement>('blockquote');

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: emailExtensions, content: SEED });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('starts folded: the history hides behind the ⋯ toggle', () => {
    expect(isHistoryFolded(editor.state)).toBe(true);
    expect(toggle()).toBeTruthy();
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
    expect(quoteEl()!.style.display).toBe('none');
    expect(quoteEl()!.classList.contains('aee-quote-folded')).toBe(true);
  });

  it('never folds a document without a trailing quote', () => {
    editor.setContent('<div>just text</div>');
    expect(historyQuoteAt(editor.state.doc)).toBeNull();
    expect(isHistoryFolded(editor.state)).toBe(false);
    expect(toggle()).toBeNull();
  });

  it('folding is presentation only — the serialized email always carries the history', () => {
    const html = editor.getHTML();
    expect(html).toContain('<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>Original message</div></blockquote>');
    expect(html).not.toContain('aee-quote');
    expect(html).not.toContain('display: none');
  });

  it('clicking the toggle expands', () => {
    toggle()!.click();
    expect(isHistoryFolded(editor.state)).toBe(false);
    expect(toggle()).toBeNull();
    expect(quoteEl()!.style.display).not.toBe('none');
  });

  it('ArrowDown from the block above expands and steps into the quote', () => {
    const quote = historyQuoteAt(editor.state.doc)!;
    // End of the attribution paragraph — the block sitting right above the fold.
    editor.exec((state, dispatch) => {
      dispatch?.(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(quote.pos), -1)),
      );
      return true;
    });
    const handled = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'ArrowDown' })),
    );
    expect(handled).toBe(true);
    expect(isHistoryFolded(editor.state)).toBe(false);
    // The cursor stepped inside the (now visible) quote.
    const { $from } = editor.state.selection;
    expect($from.node(1).type.name).toBe('blockquote');
  });

  it('any selection reaching the hidden range auto-expands — never edit invisibly', () => {
    const quote = historyQuoteAt(editor.state.doc)!;
    editor.exec((state, dispatch) => {
      dispatch?.(
        state.tr.setSelection(TextSelection.create(state.doc, quote.pos + 2)),
      );
      return true;
    });
    expect(isHistoryFolded(editor.state)).toBe(false);
  });

  it('editing above the fold keeps the expanded state tracking through position shifts', () => {
    editor.commands['expandQuotedHistory']();
    editor.exec((state, dispatch) => {
      dispatch?.(
        state.tr
          .setSelection(TextSelection.create(state.doc, 1))
          .insertText('Thanks! '),
      );
      return true;
    });
    expect(isHistoryFolded(editor.state)).toBe(false);
  });

  it('a fresh external seed starts folded again — the mapping dies with the replaced range', () => {
    editor.commands['expandQuotedHistory']();
    expect(isHistoryFolded(editor.state)).toBe(false);
    editor.setContent(replyDocument({ html: '<div>A different thread entirely</div>', from: 'Sam' }));
    expect(isHistoryFolded(editor.state)).toBe(true);
    expect(toggle()).toBeTruthy();
  });

  it('foldQuotedHistory folds back and rescues the cursor from the hidden range', () => {
    editor.commands['expandQuotedHistory']();
    const quote = historyQuoteAt(editor.state.doc)!;
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, quote.pos + 2)));
      return true;
    });
    expect(editor.commands['foldQuotedHistory']()).toBe(true);
    expect(isHistoryFolded(editor.state)).toBe(true);
    expect(editor.state.selection.from).toBeLessThanOrEqual(
      historyQuoteAt(editor.state.doc)!.pos,
    );
  });

  it('commands refuse when they have nothing to do', () => {
    expect(editor.commands['foldQuotedHistory']()).toBe(false); // already folded
    editor.commands['expandQuotedHistory']();
    expect(editor.commands['expandQuotedHistory']()).toBe(false); // already expanded
  });
});
