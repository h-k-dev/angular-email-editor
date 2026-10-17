import { createEditor, Editor } from './editor';
import { plainTextExtensions } from './extensions/kits';
import { emailPlainText, plainTextHTML } from './plain-text';

describe('plain-text projection', () => {
  it('renders lines, empty lines and quotes Gmail-style', () => {
    expect(
      emailPlainText(
        '<div>Hello <strong>world</strong></div><div><br></div>' +
          '<blockquote><div>quoted line</div><div>second</div></blockquote>',
      ),
    ).toBe('Hello world\n\n> quoted line\n> second');
  });

  it('renders lists with bullets and numbers', () => {
    expect(emailPlainText('<ul><li><div>one</div></li><li><div>two</div></li></ul>')).toBe(
      '- one\n- two',
    );
    expect(emailPlainText('<ol><li><div>one</div></li><li><div>two</div></li></ol>')).toBe(
      '1. one\n2. two',
    );
  });

  it('keeps link URLs and image alt text', () => {
    expect(emailPlainText('<div>see <a href="https://x.io">docs</a></div>')).toBe(
      'see docs (https://x.io)',
    );
    expect(emailPlainText('<div><a href="https://x.io">https://x.io</a></div>')).toBe(
      'https://x.io',
    );
    expect(emailPlainText('<img src="x.png" alt="chart">')).toBe('[chart]');
  });

  it('indents an indented line four spaces a step, and never an empty one', () => {
    expect(
      emailPlainText(
        '<div style="margin-left: 40px;">one</div><div style="margin-left: 80px;">a<br>b</div>' +
          '<div style="margin-left: 40px;"><br></div><div>flat</div>',
      ),
    ).toBe('    one\n        a\n        b\n\nflat');
  });

  it('turns hard breaks into lines without doubling the empty-line marker', () => {
    expect(emailPlainText('<div>a<br>b</div>')).toBe('a\nb');
    expect(emailPlainText('<div><br></div>')).toBe('');
  });

  it('handles nested quotes', () => {
    expect(
      emailPlainText(
        '<blockquote><div>outer</div><blockquote><div>inner</div></blockquote></blockquote>',
      ),
    ).toBe('> outer\n> > inner');
  });
});

describe('plainTextHTML', () => {
  it('writes one email line per line, an empty line as <div><br></div>, escaped', () => {
    expect(plainTextHTML('Hi <Ada> & co\n\nBye')).toBe(
      '<div>Hi &lt;Ada&gt; &amp; co</div><div><br></div><div>Bye</div>',
    );
  });

  it('is read back by emailPlainText as the same lines', () => {
    for (const text of ['one line', 'a\nb', 'a\n\n\nb', '> quoted\n- item', 'x < y && y > z']) {
      expect(emailPlainText(plainTextHTML(text))).toBe(text);
    }
  });
});

describe('plainTextExtensions', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: plainTextExtensions });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('has lines and line breaks, and nothing to format them with', () => {
    const { schema } = editor.view.state;
    expect(Object.keys(schema.marks)).toEqual([]);
    expect(Object.keys(schema.nodes).sort()).toEqual(['doc', 'hardBreak', 'paragraph', 'text']);
  });

  it('reads formatted HTML down to its text', () => {
    editor.setContent(
      '<h1>Title</h1><div>Hello <strong>world</strong> and <a href="https://x.io">a link</a></div>',
    );
    const html = editor.getHTML();
    expect(html).not.toMatch(/<(h1|strong|a)\b/);
    expect(emailPlainText(html)).toBe('Title\nHello world and a link');
  });

  it('publishes what emailPlainText reads back as the text it was given', () => {
    const text = 'Hi Ada,\n\nSure, by noon.\nGrace';
    editor.setContent(plainTextHTML(text));
    expect(emailPlainText(editor.getHTML())).toBe(text);
  });

  it('keeps the quoted history beside the text', () => {
    editor.setQuoted('<div>On Monday, Ada wrote:</div><blockquote><div>hi</div></blockquote>');
    expect(editor.getQuoted()).toContain('Ada wrote');
  });
});
