/**
 * The menu's place in real Chromium — `npm run test:render` (jsdom has no
 * layout or Popover API, so the everyday `ng test` skips this file).
 * Caret-placed menus render in the browser's top layer (`popover="manual"`),
 * escaping ancestor stacking contexts (`container-type`, `isolation`) and
 * floating toolbars while still flipping clear of a floating foot when room
 * allows, shrinking inside a short viewport, and tracking ancestor scroll.
 */
import { Component, ElementRef, afterNextRender, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { splitBlock } from 'prosemirror-commands';
import { TextSelection } from 'prosemirror-state';
import { page } from 'vitest/browser';
import {
  Editor,
  SuggestionCommandItem,
  SuggestionMenuState,
  createEditor,
  createSuggestionMenu,
  richTextExtensions,
} from '@h-k-dev/angular-email-editor';
import { SuggestionMenu } from './suggestion-menu';
import { SuggestionMenuItem } from './suggestion-menu-item';

/** Twenty rows of 32px: 640px of list, well over the box's 320px. */
const rows: SuggestionCommandItem[] = Array.from({ length: 20 }, (_, i) => ({
  id: `row${i}`,
  title: `row${i}`,
  command: () => true,
}));

@Component({
  imports: [SuggestionMenu, SuggestionMenuItem],
  template: `
    <div class="shell">
      <div #scroller class="scroller" [class.scroller--trapped]="trapped()">
        <div #editorHost></div>
        <div email-suggestion-menu #menu [state]="state()" [announceDelay]="0">
          @for (item of state()?.items; track item.id) {
            <div email-suggestion-menu-item [item]="item" style="height: 32px">{{ item.title }}</div>
          }
        </div>
      </div>
      @if (showFooter()) {
        <div #footer class="footer-bar">Footer toolbar</div>
      }
    </div>
  `,
})
class Host {
  readonly state = signal<SuggestionMenuState | undefined>(undefined);
  readonly trapped = signal(false);
  readonly showFooter = signal(false);
  readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  readonly footer = viewChild<ElementRef<HTMLElement>>('footer');
  readonly editorHost = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  readonly menu = viewChild.required('menu', { read: ElementRef });
  editor!: Editor;

  constructor() {
    afterNextRender(() => {
      this.editor = createEditor({
        parent: this.editorHost().nativeElement,
        extensions: [
          ...richTextExtensions,
          createSuggestionMenu({
            trigger: '/',
            element: this.menu().nativeElement,
            items: rows,
            onChange: (state) => this.state.set(state),
          }),
        ],
      });
    });
  }
}

describe('SuggestionMenu (render)', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let styles: HTMLStyleElement;

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const scroller = () => host.scroller().nativeElement;
  const menu = () => host.menu().nativeElement as HTMLElement;
  const listbox = () => menu().querySelector<HTMLElement>('[role=listbox]')!;
  const caret = () => host.editor.view.coordsAtPos(host.editor.view.state.selection.head);

  const settle = async () => {
    await fixture.whenStable();
    await frame();
    await fixture.whenStable();
  };

  /** Puts the caret on line `count + 1`, 20px a line. */
  const lines = async (count: number) => {
    for (let i = 0; i < count; i++) host.editor.exec(splitBlock);
    await settle();
  };

  const type = async (text: string) => {
    host.editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText(text));
      return true;
    });
    await settle();
  };

  /** The menu is whole inside the viewport, promoted to top layer, and adds no overflow. */
  const expectInView = (checkOverflow = true) => {
    const box = menu().getBoundingClientRect();
    expect(menu().style.visibility).toBe('visible');
    expect(menu().matches(':popover-open')).toBe(true);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight + 0.5);
    if (checkOverflow) expect(scroller().scrollHeight).toBeLessThanOrEqual(scroller().clientHeight);
  };

  beforeEach(async () => {
    await page.viewport(600, 380);
    styles = document.createElement('style');
    styles.textContent = `
      html, body { margin: 0; padding: 0; }
      .shell { position: relative; isolation: isolate; width: 600px; }
      .scroller { position: relative; height: 380px; width: 600px; overflow-y: auto; }
      .scroller--trapped { container-type: inline-size; scroll-padding-bottom: 88px; }
      .footer-bar {
        position: absolute; inset: auto 0 0 0; height: 88px; z-index: 999;
        background: #ddd;
      }
      .ProseMirror { white-space: pre-wrap; outline: none; }
      .ProseMirror p { margin: 0; line-height: 20px; font-size: 14px; }
    `;
    document.head.appendChild(styles);
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    await settle();
    host.editor.view.focus();
  });

  afterEach(() => {
    host.editor?.destroy();
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
    styles.remove();
  });

  it('fits neither side: goes above, shrunk to the room there, and stays put', async () => {
    await lines(13);
    await type('/');
    expectInView();
    expect(menu().getBoundingClientRect().bottom).toBeLessThanOrEqual(caret().top);
    expect(listbox().style.maxHeight).not.toBe('');

    // Still too long for either side: the cap it was given last time must not
    // make it think it fits above at full height.
    await type('row1');
    expectInView();
    expect(menu().getBoundingClientRect().bottom).toBeLessThanOrEqual(caret().top);
  });

  it('fits below once the list is short: back under the line, uncapped', async () => {
    await lines(13);
    await type('/');
    await type('row19');
    expectInView();
    expect(menu().getBoundingClientRect().top).toBeGreaterThanOrEqual(caret().bottom);
    expect(listbox().style.maxHeight).toBe('');
  });

  it('fits neither side with more room below: goes below, shrunk to the room there', async () => {
    await lines(3);
    await type('/');
    expectInView();
    expect(menu().getBoundingClientRect().top).toBeGreaterThanOrEqual(caret().bottom);
    expect(listbox().style.maxHeight).not.toBe('');
  });

  it('paints over a high-z footer toolbar even inside a container-type stacking context', async () => {
    host.trapped.set(true);
    host.showFooter.set(true);
    await settle();

    // Line 3 (y=60..80): 320px menu fits neither clear side (below clear 208px, above 56px),
    // so it opens below and overlaps the 88px footer toolbar at y=292..380.
    await lines(3);
    await type('/');
    expectInView();
    const box = menu().getBoundingClientRect();
    const footer = host.footer()!.nativeElement.getBoundingClientRect();
    expect(box.bottom).toBeGreaterThan(footer.top + 10);

    // Hit-test in the overlap: top layer wins over z-index 999 footer toolbar.
    const hit = document.elementFromPoint(box.left + 20, footer.top + 10);
    expect(menu().contains(hit)).toBe(true);
  });

  it('flips above the footer toolbar when a short menu fits clear above', async () => {
    host.trapped.set(true);
    host.showFooter.set(true);
    await settle();

    // Line 12 (y=240..260): footer covers y=292..380 (only 28px clear below),
    // so a 1-row menu flips above the line instead of sitting on the toolbar.
    await lines(12);
    await type('/row19');
    expectInView();
    expect(menu().getBoundingClientRect().bottom).toBeLessThanOrEqual(caret().top);
    expect(listbox().style.maxHeight).toBe('');
  });

  it('tracks ancestor scroll and hides when the caret scrolls out of sight', async () => {
    // 40 lines (800px total in a 380px scroller -> scrollTop range 0..420),
    // caret in the middle (line 20, content y = 400..420).
    await lines(39);
    host.editor.exec((state, dispatch) => {
      const pos = state.doc.child(0).nodeSize * 20 + 1;
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, pos)));
      return true;
    });
    scroller().scrollTop = 200;
    await settle();
    await type('/row19');
    expectInView(false);
    const before = menu().getBoundingClientRect().top;

    // Scroll 40px further down: the caret and menu move up by 40px.
    scroller().scrollTop = 240;
    await settle();
    expect(menu().getBoundingClientRect().top).toBeCloseTo(before - 40, 0);

    // Scroll back to the top so line 21 is below the scroller's visible box.
    scroller().scrollTop = 0;
    await settle();
    expect(menu().style.visibility).toBe('hidden');
    expect(menu().matches(':popover-open')).toBe(false);

    // Scroll back into sight: the menu returns.
    scroller().scrollTop = 240;
    await settle();
    expectInView(false);
  });
});
