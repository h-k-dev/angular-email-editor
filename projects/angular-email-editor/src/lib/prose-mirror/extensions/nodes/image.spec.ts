import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { emailExtensions } from '../kits';

const schema = createSchema(emailExtensions);
const roundTrip = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

describe('image node', () => {
  it('serializes hybrid sizing: width attribute for Outlook, fluid style for the rest', () => {
    expect(roundTrip('<img src="x.png" alt="chart" width="400">')).toBe(
      '<img src="x.png" alt="chart" width="400" style="width: 100%; max-width: 400px; height: auto;">',
    );
  });

  it('falls back to fluid max-width when the width is unknown', () => {
    expect(roundTrip('<img src="x.png" alt="chart">')).toBe(
      '<img src="x.png" alt="chart" style="max-width: 100%; height: auto;">',
    );
  });

  it('caps parsed widths at the email maximum', () => {
    expect(roundTrip('<img src="x.png" alt="wide" width="1200">')).toContain('width="600"');
  });

  it('reads width from styles and drops float on the floor', () => {
    expect(roundTrip('<img src="x.png" alt="a" style="float:left;width:300px">')).toBe(
      '<img src="x.png" alt="a" width="300" style="width: 100%; max-width: 300px; height: auto;">',
    );
  });

  it('stays stable across repeated round trips', () => {
    const once = roundTrip('<img src="x.png" alt="chart" width="400">');
    expect(roundTrip(once)).toBe(once);
  });
});
