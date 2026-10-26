import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from './editor';
import { insertSnippet } from './html';
import { emailExtensions, snippetExtensions } from './extensions/kits';

describe('snippetExtensions', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: snippetExtensions });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('knows words and their formatting, and nothing a message is laid out with', () => {
    const { nodes, marks } = editor.state.schema;
    for (const name of ['heading', 'blockquote', 'table', 'columns', 'section', 'image', 'button', 'divider', 'spacer']) {
      expect(nodes[name], name).toBeUndefined();
    }
    for (const name of ['paragraph', 'hardBreak', 'bulletList', 'orderedList', 'listItem']) {
      expect(nodes[name] ?? nodes['emailParagraph'], name).toBeDefined();
    }
    for (const name of ['mergeTag', 'bold', 'italic', 'underline', 'link', 'strike', 'textStyle']) {
      expect(marks[name], name).toBeDefined();
    }
  });

  it('reads a laid-out email down to its words, tokens and formatting kept', () => {
    editor.setContent(
      '<h1>Welcome</h1><table><tbody><tr><td>Hi <strong>{{firstName}}</strong></td></tr></tbody></table>' +
        '<hr><img src="x.png" alt="logo"><ul><li><div>one</div></li></ul>',
    );
    const html = editor.getHTML();
    expect(html).not.toMatch(/<h1|<table|<hr|<img/);
    expect(html).toContain('Welcome');
    expect(html).toContain('<strong style="font-weight: bold;">{{ firstName }}</strong>');
    expect(html).toContain('<li><div>one</div></li>');
  });

  it('publishes HTML the email kit reads as it is', () => {
    editor.setContent('<div>Kind regards,</div><div><em>{{ company.name }}</em> · <a href="https://example.com">example.com</a></div>');
    const snippet = editor.getHTML();
    const mail = createEditor({ parent: host, extensions: emailExtensions });
    mail.setContent(snippet);
    expect(mail.getHTML()).toBe(snippet);
    mail.destroy();
  });
});

describe('insertSnippet', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: emailExtensions });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  /** The caret after the first `|` in the line `text`. */
  function caretIn(text: string): void {
    const [before, after] = text.split('|');
    editor.setContent(`<div>${before}${after}</div>`);
    const at = 1 + before.length;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  }

  it('drops a one-line snippet into the line, as words typed at the caret', () => {
    caretIn('Dear |, thanks');
    editor.exec(insertSnippet('<div><strong>{{firstName}}</strong></div>'));
    expect(editor.getHTML()).toBe('<div>Dear <strong style="font-weight: bold;">{{ firstName }}</strong>, thanks</div>');
  });

  it('joins a snippet of lines to the text either side of the caret', () => {
    caretIn('Before |after');
    editor.exec(insertSnippet('<div>one</div><div>two</div>'));
    expect(editor.getHTML()).toBe('<div>Before one</div><div>twoafter</div>');
  });

  it('keeps a list at the snippet’s edge whole', () => {
    caretIn('Steps:|');
    editor.exec(insertSnippet('<ul><li><div>a</div></li><li><div>b</div></li></ul>'));
    const html = editor.getHTML();
    expect(html).toContain('<div>Steps:</div>');
    expect(html).toMatch(/<ul[^>]*><li><div>a<\/div><\/li><li><div>b<\/div><\/li><\/ul>/);
  });

  it('leaves the caret after what it put in', () => {
    caretIn('A|Z');
    editor.exec(insertSnippet('<div>bc</div>'));
    const { from } = editor.state.selection;
    expect(editor.state.doc.textBetween(1, from)).toBe('Abc');
  });

  it('does nothing for an empty snippet', () => {
    caretIn('A|Z');
    expect(editor.exec(insertSnippet(''))).toBe(false);
    expect(editor.getHTML()).toBe('<div>AZ</div>');
  });
});
