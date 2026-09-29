import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { emailExtensions } from './extensions/kits';
import { GOLDEN_HTML as GOLDEN } from './fixtures/golden';

const schema = createSchema(emailExtensions);
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

/** Foreign markup: no exact expectation, but the round trip must be a
    fixpoint — parsing its own output must change nothing. */
const MESSY: string[] = [
  '<p>P becomes a div line</p>',
  '<h2 style="margin: 0px; font-size: 20px;">A heading</h2><p align="center">centered legacy</p>',
  '<ul style="margin: 0px; padding-left: 24px;"><li>bare item text</li><li>another</li></ul>',
  '<div style="text-align: justify;">justify dies</div>',
  '<span style="font-weight: 700">bold span</span> trailing',
  '<div>a &copy; b &amp; c</div>',
  '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>deep</div></blockquote></blockquote>',
  '<img src="x.png" alt="wide" width="1200" style="float: left">',
  '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>',
  '<table><tr><td>no tbody in source</td></tr></table>',
  '<div style="width: 100%; max-width: 600px;"><div style="display: inline-block; width: 100%; max-width: 300px; vertical-align: top; box-sizing: border-box; padding-left: 8px; padding-right: 8px;"><div>one</div></div><div style="display: inline-block; width: 100%; max-width: 300px; vertical-align: top; box-sizing: border-box; padding-left: 8px; padding-right: 8px;"><div>two</div></div></div>',
  // A section: one presentation table for every client, the fill as bgcolor
  // and inline style with its paired text colour, the content centred.
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody><tr><td bgcolor="#f1f3f4" style="padding: 20px 0px; background-color: rgb(241, 243, 244); color: rgb(32, 33, 36);"><div style="max-width: 600px; margin-left: auto; margin-right: auto; padding-left: 16px; padding-right: 16px; box-sizing: border-box;"><div>band</div></div></td></tr></tbody></table>',
];

describe('golden canonical outputs', () => {
  for (const golden of GOLDEN) {
    it(`is identity on: ${golden.slice(0, 60)}`, () => {
      expect(canonical(golden)).toBe(golden);
    });
  }
});

describe('round-trip fixpoint on foreign markup', () => {
  for (const messy of MESSY) {
    it(`stabilizes after one pass: ${messy.slice(0, 60)}`, () => {
      const once = canonical(messy);
      expect(canonical(once)).toBe(once);
    });
  }
});
