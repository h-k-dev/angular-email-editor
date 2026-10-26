/**
 * The block marquee in real layout — `npm run test:render`, in Chromium
 * (jsdom has no layout to hit-test, no scrolling, no `::after` to measure,
 * and computes no colours).
 *
 * The page carries the app's own rules, read out of styles.scss: the
 * selection wash and the selected-block and marquee rules, so this guards
 * what the app ships — the box and the blocks it lights in one colour.
 */
import { NodeSelection, TextSelection } from 'prosemirror-state';
import appStyles from '../../../../../app/src/styles.scss' with { loader: 'text' };
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { BLOCK_RELEASING_CLASS, BLOCK_SELECTED_CLASS, BlockSelection } from './block-selection';
import { BLOCK_MARQUEE_CLASS, beginBlockMarquee, createBlockMarquee } from './block-marquee';
import { extensionSuggestions } from '../extension';
import { SuggestionMenuState, createSuggestionMenu } from './suggestion-menu';
import { BubbleMenuState, createBubbleMenu } from './bubble-menu';

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
  .canvas { position: relative; overflow: hidden; width: 560px; color-scheme: dark; }
  .header { height: 80px; }
  .aee-editor { color-scheme: light; display: block; max-width: 600px; font: 16px/20px sans-serif; white-space: pre-wrap; outline: none; }
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
    document.querySelector('.canvas')?.remove();
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

  it('on a larger canvas the box reaches past the paper — over a header — and still lights only blocks', () => {
    // The canvas: a dark frame round a light paper, a header above it — a
    // compose window with its envelope rows over the text.
    editor.destroy();
    const canvas = document.createElement('div');
    canvas.className = 'canvas';
    const header = document.createElement('header');
    header.className = 'header';
    header.textContent = 'From';
    canvas.append(header, surface);
    document.body.appendChild(canvas);
    editor = createEditor({
      parent: surface,
      extensions: [...emailExtensions, createBlockMarquee({ canvas: () => canvas })],
      content: CONTENT,
    });

    const left = rect(surface).left + 10;
    const from = rect(block(3)).top + 5;
    mouse('mousedown', left, from);
    // Up over the header: the box follows the pointer there.
    const overHeader = rect(header).top + 10;
    mouse('mousemove', left + 100, overHeader, window);
    const box = canvas.querySelector<HTMLElement>(`.${BLOCK_MARQUEE_CLASS}`)!;
    expect(box.parentElement).toBe(canvas);
    expect(rect(box).top).toBeCloseTo(overHeader, 0);
    expect(rect(box).bottom).toBeCloseTo(from, 0);
    // Only the paper's blocks are selected — the header is no block.
    expect(selected()).toEqual([0, 1, 2, 3]);

    // Past the canvas, the box stops at its edge.
    mouse('mousemove', left + 100, rect(canvas).top - 50, window);
    expect(rect(box).top).toBeCloseTo(rect(canvas).top, 0);

    // The paper's scheme, not the canvas's: the box wears the very wash
    // the blocks it lights wear.
    expect(getComputedStyle(box).colorScheme).toBe('light');
    expect(getComputedStyle(box).backgroundColor).toBe(
      getComputedStyle(block(1), '::after').backgroundColor,
    );

    mouse('mouseup', left + 100, rect(canvas).top - 50, window);
    expect(box.isConnected).toBe(false);
    expect(selected()).toEqual([0, 1, 2, 3]);
  });

  it('begun from a start point of the host’s own, the box selects the blocks it reaches; a click there changes nothing', () => {
    editor.destroy();
    const canvas = document.createElement('div');
    canvas.className = 'canvas';
    const header = document.createElement('header');
    header.className = 'header';
    canvas.append(header, surface);
    document.body.appendChild(canvas);
    editor = createEditor({
      parent: surface,
      extensions: [...emailExtensions, createBlockMarquee({ canvas: () => canvas })],
      content: CONTENT,
    });
    let started = false;
    header.addEventListener('mousedown', (event) => {
      started = beginBlockMarquee(editor.view, event);
    });
    const before = editor.state.selection;

    // A click in the header: taken, but nothing moves.
    const x = rect(surface).left + 60;
    const y = rect(header).top + 20;
    expect(mouse('mousedown', x, y, header).defaultPrevented).toBe(true);
    expect(started).toBe(true);
    mouse('mouseup', x, y, window);
    expect(editor.state.selection.eq(before)).toBe(true);

    // A drag from it down over the first lines selects them.
    mouse('mousedown', x, y, header);
    mouse('mousemove', x + 100, rect(block(1)).top + 5, window);
    expect(canvas.querySelector(`.${BLOCK_MARQUEE_CLASS}`)).not.toBeNull();
    expect(selected()).toEqual([0, 1]);
    mouse('mouseup', x + 100, rect(block(1)).top + 5, window);
    expect(selected()).toEqual([0, 1]);

    // A click there now lets the blocks go and takes the focus away, as a
    // press outside the editor does — the press was taken, so the marquee
    // does both itself.
    mouse('mousedown', x, y, header);
    mouse('mouseup', x, y, window);
    expect(selected()).toEqual([]);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.view.hasFocus()).toBe(false);

    // Not a plain primary press: not started.
    const right = new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true });
    header.dispatchEvent(right);
    expect(started).toBe(false);
  });

  it('a click at a start point of the host’s closes a selected image’s bubble menu', async () => {
    editor.destroy();
    const header = document.createElement('header');
    header.className = 'header';
    document.body.insertBefore(header, surface);
    let menu: BubbleMenuState = { isOpen: false, boundingBox: null };
    editor = createEditor({
      parent: surface,
      extensions: [
        ...emailExtensions,
        createBlockMarquee(),
        createBubbleMenu({ updateDelay: 0, onStateChange: (next) => (menu = next) }),
      ],
      content:
        '<div><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="100"></div><div>after</div>',
    });
    header.addEventListener('mousedown', (event) => beginBlockMarquee(editor.view, event));

    editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)));
    await new Promise((resolve) => setTimeout(resolve));
    expect(menu).toMatchObject({ isOpen: true, kind: 'image' });

    const x = rect(header).left + 20;
    const y = rect(header).top + 20;
    mouse('mousedown', x, y, header);
    mouse('mouseup', x, y, window);
    await frame();
    expect(editor.view.hasFocus()).toBe(false);
    expect(menu.isOpen).toBe(false);
    header.remove();
  });

  it('a click at a start point of the host’s takes the focus from a field beside the editor', () => {
    const header = document.createElement('header');
    header.className = 'header';
    const field = document.createElement('input');
    header.appendChild(field);
    document.body.insertBefore(header, surface);
    header.addEventListener('mousedown', (event) => {
      if (event.target === header) beginBlockMarquee(editor.view, event);
    });

    field.focus();
    expect(document.activeElement).toBe(field);

    const x = rect(header).right - 4;
    const y = rect(header).top + 4;
    expect(mouse('mousedown', x, y, header).defaultPrevented).toBe(true);
    mouse('mouseup', x, y, window);
    expect(document.activeElement).not.toBe(field);
    expect(editor.view.hasFocus()).toBe(false);
    header.remove();
  });

  it('let go, the blocks fade their wash out over 150ms, then drop the mark', async () => {
    const left = rect(surface).left + 10;
    mouse('mousedown', left, rect(block(1)).top + 5);
    mouse('mousemove', left + 100, rect(block(3)).top + 5, window);
    mouse('mouseup', left + 100, rect(block(3)).top + 5, window);
    expect(selected()).toEqual([1, 2, 3]);

    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(selected()).toEqual([]);
    expect(block(1).classList).toContain(BLOCK_RELEASING_CLASS);
    const fades = document
      .getAnimations()
      .filter((animation) => (animation as CSSAnimation).animationName === 'aee-block-release');
    expect(fades).toHaveLength(3);
    expect((fades[0].effect as KeyframeEffect).getTiming().duration).toBe(150);
    // Same wash as when it was lit, while it fades.
    expect(getComputedStyle(block(1), '::after').backgroundColor).toMatch(/^oklch\(0\.5 0\.2 260/);

    await Promise.all(fades.map((fade) => fade.finished));
    await frame();
    expect(editor.view.dom.querySelectorAll(`.${BLOCK_RELEASING_CLASS}`)).toHaveLength(0);
  });

  it('a press a menu on the surface took is the menu’s: no caret under it, and its row applies', () => {
    // The `/` menu at the caret, as a composer renders it: in the paper,
    // floating over the lines below the trigger's.
    editor.destroy();
    const menu = document.createElement('div');
    menu.style.cssText = 'position: absolute; left: 60px; width: 200px; background: white;';
    const row = document.createElement('div');
    row.setAttribute('role', 'option');
    row.textContent = 'Heading 1';
    row.style.height = '40px';
    menu.appendChild(row);
    let state: SuggestionMenuState | undefined;
    editor = createEditor({
      parent: surface,
      extensions: [
        ...emailExtensions,
        createBlockMarquee(),
        createSuggestionMenu({
          trigger: '/',
          items: extensionSuggestions,
          element: menu,
          onChange: (next) => (state = next),
        }),
      ],
      content: CONTENT,
    });
    surface.appendChild(menu);
    menu.style.top = `${block(5).offsetTop}px`;

    const end = editor.state.doc.child(0).nodeSize - 1;
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)).insertText(' /'),
    );
    expect(state?.open).toBe(true);
    const caret = editor.state.selection;

    // The row over line 5: pressed and let go in place, a click.
    const at = rect(row);
    const x = at.left + 20;
    const y = at.top + 10;
    expect(document.elementFromPoint(x, y)).toBe(row);
    expect(mouse('mousedown', x, y).defaultPrevented).toBe(true);
    mouse('mouseup', x, y, window);
    expect(marquee()).toBeNull();
    expect(editor.state.selection.eq(caret)).toBe(true);
    expect(state?.open).toBe(true);

    // The click the row turns into a pick: applied, the trigger gone.
    state!.select(state!.items.find((item) => item.title === 'Heading 1')!);
    expect(state?.open).toBe(false);
    expect(editor.state.doc.child(0).type.name).toBe('heading');
    expect(editor.state.doc.child(0).textContent.trimEnd()).toBe('line 0');
    menu.remove();
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

  it('a click below the last block starts a line there — a drag from it is still the box — and the line goes again unused', () => {
    editor.view.dom.style.paddingBottom = '80px';
    surface.scrollTop = surface.scrollHeight;
    const count = editor.state.doc.childCount;
    const x = rect(block(count - 1)).left + 20;
    const y = rect(block(count - 1)).bottom + 30;

    // A drag from the room below selects blocks, as before.
    expect(mouse('mousedown', x, y).defaultPrevented).toBe(true);
    mouse('mousemove', x + 10, rect(block(count - 2)).top + 5, window);
    expect(marquee()).not.toBeNull();
    mouse('mouseup', x + 10, rect(block(count - 2)).top + 5, window);
    expect(editor.state.doc.childCount).toBe(count);

    // Released in place: a fresh line under the last block, the caret on it.
    mouse('mousedown', x, y);
    mouse('mouseup', x, y, window);
    expect(editor.state.doc.childCount).toBe(count + 1);
    const { selection } = editor.state;
    expect(selection.$head.parent).toBe(editor.state.doc.lastChild);
    expect(selection.$head.parent.content.size).toBe(0);

    // A click back in the margin of a line: the unused line goes.
    const line = rect(block(count - 3));
    mouse('mousedown', rect(surface).left + 10, line.top + 10);
    mouse('mouseup', rect(surface).left + 10, line.top + 10, window);
    expect(editor.state.doc.childCount).toBe(count);
  });
});
