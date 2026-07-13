import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { emailExtensions } from './extensions/kits';

const schema = createSchema(emailExtensions);
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

/**
 * The golden corpus: exact canonical outputs, byte for byte. A failing entry
 * means the serializer's contract changed — bump the golden string only when
 * the change is deliberate, because every consumer's stored email changes
 * with it.
 */
const GOLDEN: string[] = [
  '<div>Hello <strong style="font-weight: bold;">world</strong></div>',
  '<div><br></div>',
  '<div style="text-align: center;">centered</div>',
  '<div style="text-align: right;"><br></div>',
  '<blockquote><div>quoted<br>line</div></blockquote>',
  '<div><em style="font-style: italic;">italic</em> and <u style="text-decoration: underline;">underlined</u></div>',
  '<div><s style="text-decoration: line-through;">gone</s></div>',
  // Clean canonical link: clients style links natively; editor styling is
  // toDOM-only (a styled link would re-parse its underline as a mark).
  '<div><a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a></div>',
  '<img src="x.png" alt="chart" width="400" style="width: 100%; max-width: 400px; height: auto;">',
  '<hr style="height: 1px; width: 100%; background-color: rgb(224, 224, 224); margin-top: 12px; margin-bottom: 12px;">',
  '<a href="https://x.io" style="display: inline-block; padding: 14px 28px; background-color: rgb(26, 115, 232); color: rgb(255, 255, 255); font-weight: bold; text-decoration: none;">Shop now</a>',
];

/** Foreign markup: no exact expectation, but the round trip must be a
    fixpoint — parsing its own output must change nothing. */
const MESSY: string[] = [
  '<p>P becomes a div line</p>',
  '<h2>A heading</h2><p align="center">centered legacy</p>',
  '<ul><li>bare item text</li><li>another</li></ul>',
  '<div style="text-align: justify;">justify dies</div>',
  '<span style="font-weight: 700">bold span</span> trailing',
  '<div>a &copy; b &amp; c</div>',
  '<blockquote><blockquote><div>deep</div></blockquote></blockquote>',
  '<img src="x.png" alt="wide" width="1200" style="float: left">',
  '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>',
  '<table><tr><td>no tbody in source</td></tr></table>',
  '<div style="width: 100%; max-width: 600px;"><div style="display: inline-block; width: 100%; max-width: 300px; vertical-align: top; box-sizing: border-box; padding-left: 8px; padding-right: 8px;"><div>one</div></div><div style="display: inline-block; width: 100%; max-width: 300px; vertical-align: top; box-sizing: border-box; padding-left: 8px; padding-right: 8px;"><div>two</div></div></div>',
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
