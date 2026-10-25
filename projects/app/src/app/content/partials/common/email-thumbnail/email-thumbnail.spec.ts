import { framePendingImages } from './email-thumbnail';

describe('framePendingImages — a template drawn before its tags are filled', () => {
  it('draws a token image as the placeholder frame at its width, the expression in its middle', () => {
    const out = framePendingImages(
      '<div style="text-align: center;"><img src="{{ company.logoUrl }}" alt="{{ company.name }}" width="48"></div>',
    );
    expect(out).not.toContain('<img');
    expect(out).toContain('border: 2px dashed');
    expect(out).toContain('max-width: 48px;');
    expect(out).toMatch(/<span style="[^"]*">\{\{ company\.logoUrl \}\}<\/span><\/span><\/div>$/);
  });

  it('leaves an image with a real source, and everything round it, as written', () => {
    const html =
      '<p>Hi</p><img src=\'x.png\' width="120"><!--[if mso]><img src="y.png"><![endif]-->';
    expect(framePendingImages(html)).toBe(html);
  });

  it('reads a single-quoted token source, and a frame with no width fills its line', () => {
    const out = framePendingImages("<img alt='' src='{{ banner }}'>");
    expect(out).toContain('{{ banner }}');
    expect(out).not.toContain('max-width');
  });
});
