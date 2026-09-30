import { undo } from 'prosemirror-history';
import { createEditor, Editor } from '../editor';
import { replaceHTML } from '../html';
import { replyQuote } from '../reply';
import { emailExtensions } from './kits';
import { createSendIntent, SendIntent } from './send-intent';
import { createQuotedHistory, isQuotedHistoryFolded, quotedHistory } from './quoted-history';

const QUOTE = replyQuote({ html: '<div>Original message</div>', from: 'Jane', date: 'Aug 18' });
const BLOCKQUOTE =
  '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>Original message</div></blockquote>';

describe('quoted history', () => {
  let host: HTMLElement;
  let editor: Editor;
  let sent: SendIntent[];
  let updates: number;

  const box = () => host.querySelector<HTMLElement>('.aee-quoted');
  const content = () => host.querySelector<HTMLElement>('.aee-quoted [data-slot=content]');
  const button = (slot: string) =>
    host.querySelector<HTMLButtonElement>(`.aee-quoted [data-slot=${slot}]`);

  function mount(extensions = emailExtensions, quoted: string | null = QUOTE): void {
    editor = createEditor({
      parent: host,
      extensions: [...extensions, createSendIntent({ onSend: (intent) => sent.push(intent) })],
      content: '<div>My answer</div>',
      quoted,
      onUpdate: () => updates++,
    });
  }

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    sent = [];
    updates = 0;
    mount();
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('sits below the body, folded behind ⋯, and is not the body', () => {
    expect(editor.getQuoted()).toBe(QUOTE);
    expect(quotedHistory(editor.state)).toBe(QUOTE);
    expect(editor.getHTML()).toBe('<div>My answer</div>');
    expect(box()!.getAttribute('contenteditable')).toBe('false');
    expect(isQuotedHistoryFolded(editor.state)).toBe(true);
    expect(button('fold')!.getAttribute('aria-expanded')).toBe('false');
    expect(content()!.hidden).toBe(true);
    // The quote renders after the last block of the body.
    const blocks = [...editor.view.dom.children];
    expect(blocks.at(-1)).toBe(box());
  });

  it('stays whatever replaces the body: setContent, setText, a whole-document replace', () => {
    editor.setContent('<div>A template</div>');
    expect(editor.getQuoted()).toBe(QUOTE);
    editor.setText('plain');
    expect(editor.getQuoted()).toBe(QUOTE);
    editor.exec(replaceHTML('<!doctype html><html><head></head><body><div>An .eml</div></body></html>'));
    expect(editor.getQuoted()).toBe(QUOTE);
    expect(box()).not.toBeNull();
  });

  it('keeps only what the schema keeps: foreign and unsafe markup is gone', () => {
    editor.setQuoted('<blockquote class="gmail_quote"><p onclick="x()">Hi</p><script>x()</script></blockquote>');
    expect(editor.getQuoted()).toBe(
      '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>Hi</div></blockquote>',
    );
  });

  it('⋯ shows it and folds it again; nothing of it enters the body', () => {
    button('fold')!.click();
    expect(isQuotedHistoryFolded(editor.state)).toBe(false);
    expect(button('fold')!.getAttribute('aria-expanded')).toBe('true');
    expect(content()!.hidden).toBe(false);
    expect(content()!.innerHTML).toContain('Original message');
    expect(content()!.innerHTML).toContain('Jane wrote:');

    button('fold')!.click();
    expect(isQuotedHistoryFolded(editor.state)).toBe(true);
    expect(editor.getHTML()).toBe('<div>My answer</div>');
  });

  it('the trash removes it — undoably, and it is the user’s change', () => {
    button('remove')!.click();
    expect(editor.getQuoted()).toBeNull();
    expect(box()).toBeNull();
    expect(updates).toBe(1);

    editor.exec(undo);
    expect(editor.getQuoted()).toBe(QUOTE);
    expect(box()).not.toBeNull();
  });

  it('Edit moves it into the body as ordinary text — one undo puts it back', () => {
    button('edit')!.click();
    expect(editor.getQuoted()).toBeNull();
    expect(editor.getHTML()).toBe('<div>My answer</div>' + QUOTE);
    expect(box()).toBeNull();
    expect(updates).toBe(1);

    editor.exec(undo);
    expect(editor.getHTML()).toBe('<div>My answer</div>');
    expect(editor.getQuoted()).toBe(QUOTE);
  });

  it('a host’s setQuoted is an external sync: no undo step, no onUpdate', () => {
    editor.setQuoted(null);
    expect(box()).toBeNull();
    editor.setQuoted(QUOTE);
    expect(updates).toBe(0);
    expect(editor.exec(undo)).toBe(false);
    expect(box()).not.toBeNull();
  });

  it('a new quote starts folded again', () => {
    button('fold')!.click();
    editor.setQuoted(replyQuote({ text: 'Another thread', from: 'Sam' }));
    expect(isQuotedHistoryFolded(editor.state)).toBe(true);
    expect(content()!.hidden).toBe(true);
  });

  it('is sent: the send intent carries body and quote, HTML and text', () => {
    editor.commands['requestSend']();
    expect(sent[0].html).toBe('<div>My answer</div>' + QUOTE);
    expect(sent[0].text).toContain('My answer');
    expect(sent[0].text).toContain('Original message');
  });

  it('speaks the host’s language', () => {
    editor.destroy();
    mount([
      ...emailExtensions.filter((extension) => extension.name !== 'quotedHistory'),
      createQuotedHistory({
        labels: { show: 'Zitat zeigen', hide: 'Zitat ausblenden', edit: 'Zitat bearbeiten', remove: 'Zitat entfernen' },
      }),
    ]);
    expect(button('fold')!.getAttribute('aria-label')).toBe('Zitat zeigen');
    expect(button('edit')!.getAttribute('aria-label')).toBe('Zitat bearbeiten');
    expect(button('remove')!.getAttribute('aria-label')).toBe('Zitat entfernen');
    button('fold')!.click();
    expect(button('fold')!.getAttribute('aria-label')).toBe('Zitat ausblenden');
  });

  it('without a quote there is nothing below the body', () => {
    editor.destroy();
    mount(emailExtensions, null);
    expect(editor.getQuoted()).toBeNull();
    expect(box()).toBeNull();
    expect(editor.commands['removeQuotedHistory']()).toBe(false);
    expect(editor.commands['editQuotedHistory']()).toBe(false);
  });
});
