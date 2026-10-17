/**
 * The block marquee in real layout — `npm run test:render`, in Chromium
 * (jsdom has no layout to hit-test, no scrolling, no `::after` to measure,
 * and computes no colours).
 *
 * The page carries the app's own rules, read out of styles.scss: the
 * selection wash and the selected-block and marquee rules, so this guards
 * what the app ships — the box and the blocks it lights in one colour.
 */
import { TextSelection } from 'prosemirror-state';
import appStyles from '../../../../../app/src/styles.scss' with { loader: 'text' };
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { BLOCK_SELECTED_CLASS, BlockSelection } from './block-selection';
import { BLOCK_MARQUEE_CLASS, createBlockMarquee } from './block-marquee';

/** The app's wash token, its hide-selection rules (the browser's highlight
    gone under a block selection) and its selected-block / marquee section. */
function appRules(): string {
  const token = appStyles.match(/--email-selection-wash:[\s\S]*?\);/)?.[0];
  const start = appStyles.indexOf('/* Selected blocks (`BlockSelection`');
  const end = appStyles.indexOf('/* Merge-tag pill:');
  const hideStart = appStyles.indexOf("/* ProseMirror's own hide-selection contract");
  const hideEnd = appStyles.indexOf('/* Mid-drag belt and braces');
  if (!token || start < 0 || end < start || hideStart < 0 || hideEnd < hideStart) {
    throw new Error('styles.scss moved: update the spec');
  }
  return `:root { --mat-sys-primary: oklch(0.5 0.2 260); color-scheme: light; ${token} }\n${appStyles.slice(hideStart, hideEnd)}${appStyles.slice(start, end)}`;
}

const HOST_CSS = `
  .surface {
    position: relative; overflow-y: auto; box-sizing: border-box;
    width: 520px; height: 200px; padding: 0 40px;
  }
  .aee-editor { display: block; max-width: 600px; font: 16px/20px sans-serif; white-space: pre-wrap; outline: none; }
`;

// 30 blocks: "line 0", "line 1", a divider, "line 3" … "line 29".
const CONTENT = Array.from({ length: 30 }, (_, i) =>
  i === 2 ? '<hr>' : `<div>line ${i}</div>`,
).join('');

describe('block marquee (render)', () => {
  let styles: HTMLStyleElement;
  let surface: HTMLElement;
  let editor: Editor;

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const block = (index: number) => editor.view.dom.children[index] as HTMLElement;
  const rect = (el: Element) => el.getBoundingClientRect();
  const selected = () =>
    Array.from(editor.view.dom.children)
      .map((el, i) => (el.classList.contains(BLOCK_SELECTED_CLASS) ? i : -1))
      .filter((i) => i >= 0);
  const mouse = (type: string, x: number, y: number, target?: EventTarget) => {
    const event = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: type === 'mousedown' ? 1 : 0,
    });
    (target ?? document.elementFromPoint(x, y) ?? window).dispatchEvent(event);
    return event;
  };
  const marquee = () => surface.querySelector<HTMLElement>(`.${BLOCK_MARQUEE_CLASS}`);

  beforeEach(() => {
    styles = document.createElement('style');
    styles.textContent = appRules() + HOST_CSS;
    document.head.appendChild(styles);
    surface = document.createElement('div');
    surface.className = 'surface';
    document.body.appendChild(surface);
    editor = createEditor({
      parent: surface,
      extensions: [...emailExtensions, createBlockMarquee()],
      content: CONTENT,
    });
  });

  afterEach(() => {
    editor.destroy();
    surface.remove();
    styles.remove();
  });

  it('a drag from the margin selects the blocks it touches, in the box’s own wash', () => {
    const left = rect(surface).left + 10;
    const from = rect(block(1)).top + 5;
    const to = rect(block(4)).top + 5;
    const down = mouse('mousedown', left, from);
    expect(down.defaultPrevented).toBe(true);
    mouse('mousemove', left + 100, to, window);

    expect(selected()).toEqual([1, 2, 3, 4]);
    expect(editor.state.selection).toBeInstanceOf(BlockSelection);
    const box = rect(marquee()!);
    expect(box.left).toBeCloseTo(left, 0);
    expect(box.top).toBeCloseTo(from, 0);
    expect(box.width).toBeCloseTo(100, 0);
    expect(box.height).toBeCloseTo(to - from, 0);

    // One colour twice: the box and every lit block wear the same wash —
    // the primary, its alpha set.
    const wash = getComputedStyle(marquee()!).backgroundColor;
    expect(wash).toMatch(/^oklch\(0\.5 0\.2 260 \/ 0\.14\)$/);
    expect(getComputedStyle(block(1), '::after').backgroundColor).toBe(wash);
    // Each line's box a hair inside it, so neighbours stay apart; the
    // divider's covers the room its margins make.
    expect(getComputedStyle(block(1), '::after').height).toBe('18px');
    expect(getComputedStyle(block(2)).overflow).toBe('visible');
    expect(parseFloat(getComputedStyle(block(2), '::after').height)).toBeGreaterThanOrEqual(20);

    mouse('mouseup', left + 100, to, window);
    expect(marquee()).toBeNull();
    expect(selected()).toEqual([1, 2, 3, 4]);
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it('held at the edge, the paper scrolls and the box keeps its origin in the content', async () => {
    const left = rect(surface).left + 10;
    const from = rect(block(1)).top + 5;
    mouse('mousedown', left, from);
    mouse('mousemove', left + 100, rect(surface).bottom + 30, window);
    for (let i = 0; i < 20; i++) await frame();

    const scrolled = surface.scrollTop;
    expect(scrolled).toBeGreaterThan(0);
    // The press stays where it was in the content; the box runs to the
    // paper's bottom edge (the pointer, clipped).
    expect(rect(marquee()!).top).toBeCloseTo(from - scrolled, 0);
    expect(rect(marquee()!).bottom).toBeCloseTo(rect(surface).bottom, 0);
    const lit = selected();
    expect(lit[0]).toBe(1);
    expect(lit[lit.length - 1]).toBeGreaterThan(9);
    mouse('mouseup', left + 100, rect(surface).bottom + 30, window);
  });

  it('a press on a line is the text’s; a click in the margin puts the caret on its line', () => {
    const line = rect(block(5));
    const onText = mouse('mousedown', line.left + 5, line.top + 10);
    expect(onText.defaultPrevented).toBe(false);
    mouse('mouseup', line.left + 5, line.top + 10, window);
    expect(marquee()).toBeNull();

    mouse('mousedown', rect(surface).left + 10, line.top + 10);
    mouse('mouseup', rect(surface).left + 10, line.top + 10, window);
    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(TextSelection);
    expect(selection.$head.parent.textContent).toBe('line 5');
    expect(selection.$head.parentOffset).toBe(0);
  });
});
