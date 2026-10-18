/**
 * The menu's place in a short editor — `npm run test:render`, in real
 * Chromium (jsdom has no layout, so the everyday `ng test` skips this file).
 * A compose window's editor is a 380px scroll container the menu lives in;
 * a 320px menu fits on neither side of a line in its middle, and must never
 * be clipped by the container nor stretch it with overflow.
 */
import { Component, ElementRef, afterNextRender, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { splitBlock } from 'prosemirror-commands';
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
    <div #scroller class="scroller">
      <div #editorHost></div>
      <div email-suggestion-menu #menu [state]="state()" [announceDelay]="0">
        @for (item of state()?.items; track item.id) {
          <div email-suggestion-menu-item [item]="item" style="height: 32px">{{ item.title }}</div>
        }
      </div>
    </div>
  `,
})
class Host {
  readonly state = signal<SuggestionMenuState | undefined>(undefined);
  readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
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

  /** The menu is whole inside the container's visible part, and adds no overflow. */
  const expectInView = () => {
    const box = menu().getBoundingClientRect();
    const view = scroller().getBoundingClientRect();
    expect(menu().style.visibility).toBe('visible');
    expect(box.top).toBeGreaterThanOrEqual(view.top - 0.5);
    expect(box.bottom).toBeLessThanOrEqual(view.bottom + 0.5);
    expect(scroller().scrollHeight).toBeLessThanOrEqual(scroller().clientHeight);
  };

  beforeEach(async () => {
    styles = document.createElement('style');
    styles.textContent = `
      .scroller { position: relative; height: 380px; width: 600px; overflow-y: auto; }
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
});
