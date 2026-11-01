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

  it('leaves the client its own: `normal` reads as no line height, and is kept as written', () => {
    const html = '<div style="line-height: normal;">x</div>';
    expect(parseHTML(html, schema).child(0).attrs['lineHeight']).toBeNull();
    expect(canonical(html)).toBe(html);
  });

  it('leaves a line height a builder’s wrapping div declares on the wrapper — never written down onto its lines', () => {
    const html = '<div style="line-height: 30px; color: #ff0000;"><p>one</p><p>two</p></div>';
    const wrapper = parseHTML(html, schema).child(0);
    expect(wrapper.childCount).toBe(2);
    wrapper.forEach((line) => expect(line.attrs['lineHeight']).toBeNull());
    expect(canonical(html)).toBe(html);
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
