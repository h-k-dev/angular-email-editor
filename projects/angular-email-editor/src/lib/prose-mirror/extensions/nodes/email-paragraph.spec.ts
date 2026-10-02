import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { emailExtensions } from '../kits';

const schema = createSchema(emailExtensions);

describe('email paragraph line height', () => {
  const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

  it('keeps a line height as written — number, percentage, px — a round-trip fixpoint', () => {
    for (const value of ['1', '120%', '22px']) {
      const html = `<div style="line-height: ${value};">x</div>`;
      expect(canonical(html)).toBe(html);
    }
  });

  it('leaves the client its own: `normal`, and nothing else measurable', () => {
    expect(canonical('<div style="line-height: normal;">x</div>')).toBe('<div>x</div>');
  });

  it('takes a line height a builder’s wrapping div declares, down onto its lines', () => {
    const out = canonical(
      '<div style="line-height: 30px; color: #ff0000;"><p>one</p><p>two</p></div>',
    );
    expect(out.match(/line-height: 30px;/g)).toHaveLength(2);
    // Never onto the words: a span reads no line height.
    expect(out).not.toMatch(/<span[^>]*line-height/);
  });
});

describe('email paragraph empty-line marker', () => {
  it('parses <div><br></div> back to an EMPTY paragraph, bytes unchanged', () => {
    // The <br> is emit-side transport (mail clients collapse a bare empty
    // div), not content. Read as a hardBreak it makes the editor render a
    // double-height blank line (marker + trailing break) while the email
    // shows a single one.
    const doc = parseHTML('<div>a</div><div><br></div><div>b</div>', schema);
    expect(doc.child(1).childCount).toBe(0);
    expect(serializeToHTML(doc, schema)).toBe('<div>a</div><div><br></div><div>b</div>');
  });

  it('treats an aligned or <p>-flavoured marker the same, keeping the align', () => {
    const doc = parseHTML('<p style="text-align: right;"><br></p>', schema);
    expect(doc.child(0).childCount).toBe(0);
    expect(doc.child(0).attrs['align']).toBe('right');
  });

  it('keeps a real mid-text hard break as content', () => {
    const doc = parseHTML('<div>a<br>b</div>', schema);
    expect(doc.child(0).childCount).toBe(3); // text, hardBreak, text
  });
});
