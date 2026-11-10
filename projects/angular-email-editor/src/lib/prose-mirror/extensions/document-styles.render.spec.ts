/**
 * A document's body, drawn on the editor's root — `npm run test:render`, in
 * real Chromium (jsdom reads no `@scope` and answers no cascade).
 *
 * The case it grew from: an email whose `<body bgcolor="#FFFFFF">` turns
 * black by a rule of its head in dark (`@media (prefers-color-scheme: dark)
 * { body { background-color: #000 !important } }`), and whose last line —
 * a tracking pixel in a `<div>` — stands under its wrapper table. In the
 * editor that line showed the root: a white strip under a dark email.
 */
import { createEditor, Editor } from '../editor';
import { createDarkRendering } from './dark-rendering';
import { emailExtensions } from './kits';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const page = (head: string, body: string) =>
  `<!doctype html><html><head><style>${head}</style></head><body ${body}>` +
  '<table class="shell" width="100%"><tbody><tr><td>Hello</td></tr></tbody></table>' +
  `<div><img src="${PIXEL}" width="1" height="1" alt=""></div></body></html>`;

/** The email of the report: white by its body, black by its head in dark. */
const DECLARED = page(
  'body { margin: 0 !important; padding: 0 !important; height: 100% !important; font-family: Georgia, serif; }\n' +
    '.shell { background-color: #ffffff; }\n' +
    '@media (prefers-color-scheme: dark) {\n' +
    '  body { background-color: #000000 !important; color: #ffffff !important; }\n' +
    '  .shell { background-color: #000000 !important; }\n' +
    '}',
  'bgcolor="#FFFFFF"',
);

describe('a document’s body on the editor’s root (render)', () => {
  let paper: HTMLElement;
  let hostRules: HTMLStyleElement;
  let editor: Editor;

  const mount = (content: string, scheme: 'light' | 'dark') => {
    paper.setAttribute('data-color-scheme', scheme);
    editor = createEditor({
      parent: paper,
      extensions: [...emailExtensions, createDarkRendering()],
      content,
    });
  };
  const root = () => getComputedStyle(editor.view.dom);
  const shell = () => getComputedStyle(editor.view.dom.querySelector('.shell')!);
  /** What shows behind the last line: nothing of its own, so the root. */
  const strip = () => {
    const line = editor.view.dom.lastElementChild as HTMLElement;
    expect(line.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(getComputedStyle(line).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    return root().backgroundColor;
  };

  beforeEach(() => {
    // A host's own surface for the root, by class — as the app's is.
    hostRules = document.createElement('style');
    hostRules.textContent =
      '.paper > .aee-editor.aee-document { padding: 12px; background-color: #eeeeee; font-family: Arial, sans-serif; color: #444444; }';
    document.head.appendChild(hostRules);
    paper = document.createElement('div');
    paper.className = 'paper';
    document.body.appendChild(paper);
  });

  afterEach(() => {
    editor?.destroy();
    paper.remove();
    hostRules.remove();
  });

  it('the browser prefers light all through — the paper alone says dark', () => {
    expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(false);
  });

  it('on light paper the email is as its body says: white, no dark rule of its head applied', () => {
    mount(DECLARED, 'light');
    expect(strip()).toBe('rgb(255, 255, 255)');
    expect(shell().backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('on dark paper its own dark rules apply — the body’s on the root: no white strip under the email', () => {
    mount(DECLARED, 'dark');
    expect(shell().backgroundColor).toBe('rgb(0, 0, 0)');
    expect(strip()).toBe('rgb(0, 0, 0)');
    expect(root().color).toBe('rgb(255, 255, 255)');
  });

  it('follows the paper when it turns, the document untouched', () => {
    mount(DECLARED, 'dark');
    const before = editor.getHTML();
    paper.setAttribute('data-color-scheme', 'light');
    expect(strip()).toBe('rgb(255, 255, 255)');
    paper.setAttribute('data-color-scheme', 'dark');
    expect(strip()).toBe('rgb(0, 0, 0)');
    expect(editor.getHTML()).toBe(before);
  });

  it('gives the root the body’s face over the host’s surface, and leaves the root’s box to the host', () => {
    mount(DECLARED, 'light');
    expect(root().fontFamily).toBe('Georgia, serif');
    // `padding: 0 !important` and `height: 100% !important` are the body's
    // in a client's window, never the root's in its host.
    expect(root().paddingTop).toBe('12px');
    expect(editor.view.dom.style.getPropertyValue('height')).toBe('');
    expect(root().getPropertyValue('--aee-body-padding').trim()).toBe('0');
  });

  it('an email that says nothing of dark: its white body is drawn dark with the rest, by Dawn', () => {
    mount(page('.shell { font-size: 14px; }', 'bgcolor="#FFFFFF"'), 'dark');
    expect(strip()).not.toBe('rgb(255, 255, 255)');
    paper.setAttribute('data-color-scheme', 'light');
    expect(strip()).toBe('rgb(255, 255, 255)');
  });

  it('a body coloured by a rule of the head is drawn dark on dark paper too, and as written on light', () => {
    const ruled = page('body { background-color: #f4f4f4; color: #333333; }', '');
    mount(ruled, 'light');
    expect(strip()).toBe('rgb(244, 244, 244)');
    expect(root().color).toBe('rgb(51, 51, 51)');
    paper.setAttribute('data-color-scheme', 'dark');
    expect(strip()).not.toBe('rgb(244, 244, 244)');
    // Ink that reads on it: lighter than it was.
    const [red] = root().color.match(/\d+/g)!.map(Number);
    expect(red).toBeGreaterThan(150);
  });
});
