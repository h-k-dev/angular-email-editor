import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Viewport } from '../../../../services/viewport';
import { FormattingCommands } from '../formatting-commands';
import { FormattingToolbar } from './formatting-toolbar';

/** Every tool is this wide, the row ends here, and the ⋯ — once shown —
    takes one tool's width out of the row, as the real layout would. */
const TOOL = 40;
const ROW_END = 260;

/** jsdom has no layout: the row, its tools and the ⋯ get the boxes above. */
function stubLayout(): void {
  const isItem = (el: Element) => el.hasAttribute('toolbaroverflowitem');
  const isMore = (el: Element) => el.classList.contains('toolbar__more');
  const more = () => document.querySelector<HTMLElement>('.toolbar__more');
  const moreShown = () => !!more() && !more()!.hidden;

  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('toolbar__scroll')) return ROW_END - (moreShown() ? TOOL : 0);
    if (isMore(this)) return this.hidden ? 0 : TOOL;
    return isItem(this) ? TOOL : 1;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    let right = 0;
    if (this.classList.contains('toolbar__scroll')) {
      right = ROW_END - (moreShown() ? TOOL : 0);
    } else if (isItem(this)) {
      const items = [...document.querySelectorAll('[toolbaroverflowitem]')];
      right = TOOL * (items.indexOf(this) + 1);
    }
    return new DOMRect(0, 0, right, TOOL);
  });
}

/** Keeps the observers so a test can play a resize. */
const observers: (() => void)[] = [];
class ResizeObserverStub {
  constructor(callback: () => void) {
    observers.push(callback);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

@Component({
  imports: [FormattingToolbar],
  providers: [FormattingCommands],
  template: `<div formatting-toolbar aria-label="Text formatting"></div>`,
})
class Host {}

describe('FormattingToolbar', () => {
  let fixture: ComponentFixture<Host>;
  let root: HTMLElement;
  const compact = signal(false);

  const button = (label: string) =>
    root.querySelector(`.toolbar__scroll [aria-label="${label}"]`) as HTMLElement;
  const more = () => root.querySelector('.toolbar__more') as HTMLButtonElement;

  beforeEach(async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    observers.length = 0;
    compact.set(false);
    stubLayout();
    TestBed.configureTestingModule({
      providers: [{ provide: Viewport, useValue: { compact, narrow: compact } }],
    });
    fixture = TestBed.createComponent(Host);
    root = fixture.nativeElement;
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelector('.cdk-overlay-container')?.replaceChildren();
  });

  it('moves the tail that no longer fits into the ⋯, from the end, and stays put once it shows', async () => {
    // 16 tools of 40px in a 260px row: the ⋯ needs one tool's room, so the
    // line keeps five (200px) and the sixth — Bulleted list — moves.
    expect(more().hidden).toBe(false);
    expect(button('Link').hasAttribute('data-overflow')).toBe(false);
    expect(button('Bulleted list').hasAttribute('data-overflow')).toBe(true);
    expect(button('Insert table').hasAttribute('data-overflow')).toBe(true);

    // The ⋯ took its room from the row; measuring again moves nothing more.
    for (const observe of observers) observe();
    await fixture.whenStable();
    expect(button('Link').hasAttribute('data-overflow')).toBe(false);
    expect(button('Bulleted list').hasAttribute('data-overflow')).toBe(true);
  });

  it('lists the moved buttons in the ⋯ menu, and opens a moved picker from there', async () => {
    more().click();
    await fixture.whenStable();

    const items = [...document.querySelectorAll<HTMLElement>('[ngmenuitem]')];
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'format_list_bulletedBulleted list',
      'format_list_numberedNumbered list',
      'format_indent_decreaseIndent less',
      'format_indent_increaseIndent more',
      'format_quoteQuote',
      'format_align_leftAlign left',
      'format_align_centerAlign center',
      'format_align_rightAlign right',
      'format_strikethroughStrikethrough',
      'keyboard_capslockUppercase',
      'format_clearClear formatting',
      'table_chartInsert table',
    ]);
    // Toggles read as checkboxes; the toolbar's groups become separators.
    expect(items[0].getAttribute('role')).toBe('menuitemcheckbox');
    expect(items.at(-1)!.getAttribute('role')).toBe('menuitem');
    expect(document.querySelectorAll('.toolbar-menu__separator').length).toBe(3);

    items.at(-1)!.click();
    await fixture.whenStable();
    expect(document.querySelector('[table-picker]')).not.toBeNull();
    expect(more().getAttribute('aria-expanded')).toBe('false');
  });

  it('moves nothing on a phone, where the row scrolls instead', async () => {
    compact.set(true);
    await fixture.whenStable();
    expect(more().hidden).toBe(true);
    expect(root.querySelectorAll('[data-overflow]').length).toBe(0);
  });

  it('keeps a phone row of marks, link and clearing — colour, lists, quote, alignment and table are wide-only', () => {
    const phone = [...root.querySelectorAll<HTMLElement>('.toolbar__scroll > button')]
      .filter((el) => !el.classList.contains('toolbar__wide'))
      .map((el) => el.getAttribute('aria-label'));
    expect(phone).toEqual([
      'Bold',
      'Italic',
      'Underline',
      'Link',
      'Strikethrough',
      'Uppercase',
      'Clear formatting',
    ]);
    // A group that is wide-only through and through (quote and alignment,
    // the table) goes whole on a phone, so its divider goes with it.
    const dividers = [...root.querySelectorAll('.toolbar__scroll > mat-divider')];
    expect(dividers.filter((el) => !el.classList.contains('toolbar__wide')).length).toBe(2);
  });

  it('says pressed only for what can be on: a toggle, never a plain command', () => {
    expect(button('Bold').hasAttribute('aria-pressed')).toBe(true);
    expect(button('Link').hasAttribute('aria-pressed')).toBe(true);
    expect(button('Clear formatting').hasAttribute('aria-pressed')).toBe(false);
  });

  it('arrow keys walk the tools on the line — skipping what moved into the ⋯ and what is disabled — and wrap', () => {
    const press = (el: HTMLElement, key: string) => {
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      return document.activeElement;
    };
    const family = root.querySelector('.toolbar__select--family') as HTMLElement;
    expect(press(family, 'ArrowRight')).toBe(root.querySelector('.toolbar__select--size'));
    expect(press(button('Bold'), 'ArrowRight')).toBe(button('Italic'));
    expect(press(button('Italic'), 'ArrowLeft')).toBe(button('Bold'));
    // Link is the last tool on the line: Right passes the moved tail and
    // lands on the ⋯ — and, with no editor, Undo and Redo are disabled and
    // passed over too, so the ⋯ is also the end, and the wrap from the start.
    expect(press(button('Link'), 'ArrowRight')).toBe(more());
    expect(press(button('Bold'), 'End')).toBe(more());
    expect(press(family, 'ArrowLeft')).toBe(more());
    expect(press(more(), 'Home')).toBe(family);
    // Keys the toolbar does not own pass through.
    expect(press(button('Bold'), 'ArrowDown')).toBe(button('Bold'));
  });
});
