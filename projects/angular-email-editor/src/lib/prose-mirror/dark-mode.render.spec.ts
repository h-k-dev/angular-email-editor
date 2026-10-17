/**
 * The editor's dark paper and the sent email's dark mode are one rendering —
 * `npm run test:render`, in real Chromium (jsdom has no `:has()` to speak
 * of, and computes no colours).
 *
 * The same canonical HTML is drawn twice: once as the editor shows it in
 * dark (`darkModeEditorCss` over the untouched markup), once as Apple Mail
 * shows the sent email (`markDarkMode`'s classes, its media query answered
 * dark). Every element must come out the same colour on the same
 * background — and the palette's must have moved, or the test proves
 * nothing.
 */
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { emailExtensions } from './extensions/kits';
import { darkModeEditorCss, markDarkMode } from './dark-mode';
import { resolveColorScheme } from './client-rendering';

const SCOPE = '.dark-paper > .aee-editor';

/** A message wearing every kind of colour: palette text on the page, a
    highlighted run, a filled table cell and column panel, and colours typed
    into the source — a foreign text colour inside a palette fill, palette
    text inside a foreign fill, a fill under a picture. */
const MESSAGE = [
  '<p>Plain <span style="color: #c5221f">red</span> and <span style="color: #0366da">blue</span>.</p>',
  '<p><span style="background-color: #fef7e0">highlighted</span> and ',
  '<span style="color: #9333ea; background-color: #e8f0fe">purple on blue</span></p>',
  '<table><tbody><tr><td style="background-color: #e6f4ea"><p>Cell <span style="color: #0f7b33">green</span></p></td>',
  '<td style="background-color: #fce8e6"><p>Typed <span style="color: #333333">grey</span> keeps it light</p></td></tr></tbody></table>',
  '<div style="background-color: #ffcc00; color: #202124"><p>Foreign fill, <span style="color: #c5221f">red</span> stays</p></div>',
  '<div style="background-color: #fce8e6; background-image: url(x.png)"><p>Picture</p></div>',
].join('');

function draw(markup: string, css: string, wrap: (host: HTMLElement) => HTMLElement): HTMLElement {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = wrap(host);
  root.innerHTML = markup;
  return root;
}

function colours(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('*')).map((el) => {
    const computed = getComputedStyle(el);
    return `${el.tagName} ${computed.color} on ${computed.backgroundColor}`;
  });
}

describe('dark mode: the editor shows what the email sends', () => {
  afterEach(() => {
    document.head.querySelectorAll('style').forEach((el) => el.remove());
    document.body.replaceChildren();
  });

  it('every element the same colour on the same background', () => {
    const schema = createSchema(emailExtensions);
    const html = serializeToHTML(parseHTML(MESSAGE, schema, { mode: 'email' }), schema);

    const editor = draw(html, darkModeEditorCss(SCOPE), (host) => {
      host.className = 'dark-paper';
      const root = document.createElement('div');
      root.className = 'aee-editor';
      host.appendChild(root);
      return root;
    });
    const sent = markDarkMode(html);
    const email = draw(sent.html, resolveColorScheme(sent.css, true), (host) => host);

    const editorColours = colours(editor);
    expect(colours(email)).toEqual(editorColours);
    // The palette moved: red lit, the green cell dark — and the typed ones did not.
    expect(editorColours.join('\n')).toContain('rgb(255, 105, 91)'); // red's variant
    expect(editorColours.join('\n')).toContain('rgb(24, 54, 36)'); // the green fill's
    expect(editorColours.join('\n')).toContain('rgb(197, 34, 31) on rgba(0, 0, 0, 0)'); // red under #ffcc00
    expect(editorColours.join('\n')).toContain('rgb(252, 232, 230)'); // the cell holding grey
  });
});
