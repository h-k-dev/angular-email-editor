import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { emailExtensions } from '../kits';

const schema = createSchema(emailExtensions);

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
