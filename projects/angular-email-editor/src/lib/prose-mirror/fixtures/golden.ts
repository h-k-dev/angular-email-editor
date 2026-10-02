/**
 * The golden corpus: exact canonical outputs, byte for byte. A failing entry
 * means the serializer's contract changed — bump the golden string only when
 * the change is deliberate, because every consumer's stored email changes
 * with it.
 */
export const GOLDEN_HTML: string[] = [
  '<div>Hello <strong style="font-weight: bold;">world</strong></div>',
  '<div><br></div>',
  '<div style="text-align: center;">centered</div>',
  '<div style="text-align: right;"><br></div>',
  '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>quoted<br>line</div></blockquote>',
  '<div><em style="font-style: italic;">italic</em> and <u style="text-decoration: underline;">underlined</u></div>',
  '<div><s style="text-decoration: line-through;">gone</s></div>',
  '<div><span style="font-size: 18px; font-family: Georgia, Times, serif;">styled</span></div>',
  // Fills always pair an explicit near-black text colour (FILL_TEXT_COLOR):
  // default text flips to near-white in non-transforming dark modes.
  '<div><span style="color: rgb(32, 33, 36); background-color: rgb(254, 247, 224);">highlit</span></div>',
  '<table style="width: 100%; table-layout: fixed; border-collapse: collapse;" role="presentation"><tbody><tr><td style="padding: 8px 12px; vertical-align: top; overflow-wrap: break-word; background-color: rgb(230, 244, 234); color: rgb(32, 33, 36);">cell</td></tr></tbody></table>',
  // Clean canonical link: clients style links natively; editor styling is
  // toDOM-only (a styled link would re-parse its underline as a mark).
  '<div><a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a></div>',
  // Inline image, Gmail's own shape: on a line of its own it wraps in a div
  // line; inside text it stays in the line (the caret stands beside it).
  '<div><img src="x.png" alt="chart" width="400" style="width: 100%; max-width: 400px; height: auto;"></div>',
  '<div>see <img src="x.png" alt="chart" style="max-width: 100%; height: auto;"> here</div>',
  // A placeholder: a sized frame with no source yet (linted, never a lie).
  '<div><img width="320" style="width: 100%; max-width: 320px; height: auto;"></div>',
  '<hr style="height: 1px; width: 100%; background-color: rgb(224, 224, 224); margin-top: 12px; margin-bottom: 12px;">',
  // Button is inline (so a cell can hold one). On a line of its own it
  // wraps in a div, like an image; a stored bare `<a>` repairs the same way.
  '<div><a href="https://x.io" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: rgb(26, 115, 232); color: rgb(255, 255, 255); font-weight: bold; text-decoration: none; white-space: nowrap; border-width: 14px 28px; border-style: solid; border-color: rgb(26, 115, 232);">Shop now</a></div>',
];
