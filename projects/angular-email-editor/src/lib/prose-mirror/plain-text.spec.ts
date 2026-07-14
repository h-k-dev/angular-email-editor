import { emailPlainText } from './plain-text';

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
