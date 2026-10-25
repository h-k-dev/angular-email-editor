/**
 * A preview draws columns as the sent email does — `npm run test:render`, in
 * real Chromium (jsdom lays nothing out and answers no media query).
 *
 * The editor's two columns, drawn by `renderForClient` in a frame a phone
 * wide, must stack and each fill the width, as `emailDocument`'s phone rule
 * makes them; a desktop-wide frame keeps them side by side at their caps.
 */
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { emailExtensions } from './extensions/kits';
import { renderForClient } from './client-rendering';

const COLUMN =
  '<div class="aee-layout-column" style="display: inline-block; width: 100%; max-width: 280px; vertical-align: top; box-sizing: border-box;"><div>words</div></div>';

/** Two columns as the editor writes them. */
function twoColumns(): string {
  const schema = createSchema(emailExtensions);
  return serializeToHTML(
    parseHTML(
      `<div class="aee-layout-columns" style="width: 100%; max-width: 600px;">${COLUMN}${COLUMN}</div>`,
      schema,
    ),
    schema,
  );
}

/** Each column's box in a frame `width` px wide: [left, top, width]. */
async function columnBoxes(html: string, width: number): Promise<number[][]> {
  const frame = document.createElement('iframe');
  frame.style.cssText = `width: ${width}px; height: 600px; border: 0;`;
  document.body.appendChild(frame);
  await new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.srcdoc = html;
  });
  const boxes = Array.from(
    frame.contentDocument!.querySelectorAll<HTMLElement>('.aee-layout-column'),
  ).map((column) => {
    const box = column.getBoundingClientRect();
    return [Math.round(box.left), Math.round(box.top), Math.round(box.width)];
  });
  frame.remove();
  return boxes;
}

describe('a preview stacks columns as the sent email does', () => {
  it('on a phone, each stacked column fills the width', async () => {
    const html = twoColumns();
    expect(html).toContain('max-width: 280px');
    for (const client of ['apple-mail', 'gmail'] as const) {
      const [first, second] = await columnBoxes(
        renderForClient(html, client, { pane: 'phone' }),
        375,
      );
      expect(second[1]).toBeGreaterThan(first[1]);
      expect(first[2]).toBe(375);
      expect(second[2]).toBe(375);
    }
  });

  it('on a desktop, the columns sit side by side at their caps', async () => {
    const [first, second] = await columnBoxes(renderForClient(twoColumns(), 'apple-mail'), 640);
    expect(second[1]).toBe(first[1]);
    expect(first[2]).toBe(280);
  });
});
