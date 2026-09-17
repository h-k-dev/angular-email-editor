import { Component, ElementRef, afterNextRender, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Editor, createEditor } from '../../prose-mirror/editor';
import {
  SuggestionCommandItem,
  SuggestionGroup,
  SuggestionPage,
  extensionSuggestions,
} from '../../prose-mirror/extension';
import { richTextExtensions } from '../../prose-mirror/extensions/kits';
import {
  SuggestionMenuState,
  createSuggestionMenu,
} from '../../prose-mirror/extensions/suggestion-menu';
import { SuggestionMenu } from './suggestion-menu';
import { SuggestionMenuItem } from './suggestion-menu-item';
import { SuggestionMenuHeader } from './suggestion-menu.slots';

const templates: SuggestionGroup = {
  id: 'templates',
  title: 'Templates',
  children: [
    { id: 'welcome', title: 'Welcome mail', command: () => true },
    { id: 'invoice', title: 'Invoice reminder', command: () => true },
  ],
};

/** Pages a group asks for, resolved by hand: page n of 3, two rows each. */
const pageRequests: Array<{ cursor: string | null; resolve: () => void }> = [];
/** A group whose source is down. */
let failBroken: (reason: unknown) => void = () => {};
const broken: SuggestionGroup = {
  id: 'broken',
  title: 'Broken',
  children: () => new Promise((_, reject) => (failBroken = reject)),
};

const remote: SuggestionGroup = {
  id: 'remote',
  title: 'Remote',
  children: ({ cursor }) =>
    new Promise<SuggestionPage<SuggestionCommandItem>>((resolve) => {
      const page = cursor ? Number(cursor) : 0;
      const items = [0, 1].map((row) => ({
        id: `r${page}-${row}`,
        title: `Row ${page}.${row}`,
        command: () => true,
      }));
      const nextCursor = page < 2 ? String(page + 1) : null;
      pageRequests.push({ cursor, resolve: () => resolve({ items, nextCursor }) });
    }),
};

/** Stands in for jsdom's missing IntersectionObserver: records what is
    watched, and lets a spec say the end marker came into view. */
class FakeIntersectionObserver {
  static last: FakeIntersectionObserver | undefined;
  readonly watched = new Set<Element>();
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.last = this;
  }
  observe(target: Element) {
    this.watched.add(target);
  }
  unobserve(target: Element) {
    this.watched.delete(target);
  }
  disconnect() {
    this.watched.clear();
  }
  intersect() {
    const entries = [...this.watched].map((target) => ({ target, isIntersecting: true }));
    this.callback(entries as unknown as IntersectionObserverEntry[], this as never);
  }
}

/** A composer the way the pair is meant to be used: the real extension
    feeds the menu its state, the host renders a row per item. */
@Component({
  imports: [SuggestionMenu, SuggestionMenuItem, SuggestionMenuHeader],
  template: `
    <div class="surface" style="position: relative">
      <div #editorHost></div>
      <div
        email-suggestion-menu
        #menu
        label="Insert block"
        [state]="state()"
        [emptyLabel]="emptyLabel()"
        [announceDelay]="announceDelay()"
      >
        @if (customHeader()) {
          <ng-template emailSuggestionMenuHeader let-group let-back="back">
            <button class="custom-back" (click)="back()">‹</button>
            <strong>{{ group.title }}</strong>
          </ng-template>
        }
        @for (item of state()?.items; track item.id) {
          <div email-suggestion-menu-item [item]="item">{{ item.title }}</div>
        }
      </div>
    </div>
  `,
})
class Host {
  readonly state = signal<SuggestionMenuState | undefined>(undefined);
  readonly emptyLabel = signal('No results');
  /** No settling wait, unless a spec is about the wait. */
  readonly announceDelay = signal(0);
  readonly customHeader = signal(false);
  readonly editorHost = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  readonly menu = viewChild.required('menu', { read: ElementRef });
  editor!: Editor;
  /** The trigger's box, counted: placement must measure only when it has to. */
  readonly coordsAtPos = vi.fn(() => ({ left: 30, right: 31, top: 40, bottom: 56 }));

  constructor() {
    afterNextRender(() => {
      this.editor = createEditor({
        parent: this.editorHost().nativeElement,
        extensions: [
          ...richTextExtensions,
          createSuggestionMenu({
            trigger: '/',
            debounce: 0,
            element: this.menu().nativeElement,
            id: 'slash',
            items: (ctx) => [...extensionSuggestions(ctx), templates, remote, broken],
            // A second trigger into the same box, with a name of its own.
            triggers: [
              {
                trigger: '@',
                id: 'people',
                label: 'People',
                items: [{ id: 'ada', title: 'Ada', command: () => true }],
              },
            ],
            onChange: (state) => this.state.set(state),
          }),
        ],
      });
      this.editor.view.coordsAtPos = this.coordsAtPos;
    });
  }
}

describe('SuggestionMenu', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let menu: HTMLElement;

  const listbox = () => menu.querySelector<HTMLElement>('[role=listbox]')!;
  const options = () => [...menu.querySelectorAll<HTMLElement>('[role=option]')];
  const header = () => menu.querySelector<HTMLElement>('[data-slot=header]');
  const status = () => menu.querySelector<HTMLElement>('[data-slot=status]')!;
  const announcer = () => menu.querySelector<HTMLElement>('[role=status]')!;

  const type = async (text: string) => {
    host.editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText(text));
      return true;
    });
    await fixture.whenStable();
  };

  const keydown = async (key: string) => {
    host.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    document.elementFromPoint ??= () => null;
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    FakeIntersectionObserver.last = undefined;
    pageRequests.length = 0;
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    menu = (fixture.nativeElement as HTMLElement).querySelector('[email-suggestion-menu]')!;
  });

  afterEach(() => {
    host.editor?.destroy();
    (fixture.nativeElement as HTMLElement).remove();
    vi.unstubAllGlobals();
  });

  it('gives the listbox the id the editor controls', async () => {
    await type('/');
    expect(listbox().id).toBe('slash');
    expect(host.editor.view.dom.getAttribute('aria-controls')).toBe('slash');
    expect(listbox().getAttribute('aria-label')).toBe('Insert block');
    expect(menu.getAttribute('data-level')).toBe('1');
  });

  it('serves a second trigger from the same box, named by that trigger', async () => {
    await type('/head');
    expect(listbox().getAttribute('aria-label')).toBe('Insert block');
    await keydown('Escape');

    await type(' @');
    expect(listbox().id).toBe('people');
    expect(listbox().getAttribute('aria-label')).toBe('People');
    expect(options().map((option) => option.id)).toEqual(['people-option-0']);
    expect(host.editor.view.dom.getAttribute('aria-controls')).toBe('people');
    expect(menu.style.visibility).toBe('visible');
  });

  it('renders rows as options carrying the ids the editor points at', async () => {
    await type('/head');
    expect(options().map((option) => option.id)).toEqual([
      'slash-option-0',
      'slash-option-1',
      'slash-option-2',
    ]);
    expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(options()[0].hasAttribute('data-active')).toBe(true);
    expect(options().every((option) => !option.hasAttribute('tabindex'))).toBe(true);

    await keydown('ArrowDown');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(host.editor.view.dom.getAttribute('aria-activedescendant')).toBe(options()[1].id);
  });

  it('applies a row on click', async () => {
    await type('/quo');
    options()[0].click();
    await fixture.whenStable();
    expect(host.editor.getHTML()).toContain('<blockquote');
    expect(host.state()?.open).toBe(false);
  });

  it('opens a group on click, with a header naming it and a back button', async () => {
    await type('/temp');
    expect(options()[0].getAttribute('data-group')).toBe('true');
    expect(header()).toBeNull();

    options()[0].click();
    await fixture.whenStable();

    expect(menu.getAttribute('data-level')).toBe('2');
    expect(header()?.querySelector('[data-slot=title]')?.textContent).toBe('Templates');
    expect(listbox().getAttribute('aria-label')).toBe('Templates');
    expect(options().map((option) => option.textContent?.trim())).toEqual([
      'Welcome mail',
      'Invoice reminder',
    ]);

    const back = header()!.querySelector<HTMLButtonElement>('[data-slot=back]')!;
    expect(back.getAttribute('aria-label')).toBe('Back');
    expect(back.tabIndex).toBe(-1);
    back.click();
    await fixture.whenStable();
    expect(host.editor.state.doc.textContent).toBe('/');
    expect(header()).toBeNull();
  });

  it('says so when nothing matches inside a group, in the words it is given', async () => {
    host.emptyLabel.set('Keine Treffer');
    await type('/templates zzz');
    expect(options()).toHaveLength(0);
    expect(status().textContent).toBe('Keine Treffer');
    expect(status().hasAttribute('data-empty')).toBe(false);

    await keydown('Escape');
    expect(status().textContent).toBe('');
    expect(status().hasAttribute('data-empty')).toBe(true);
  });

  it('renders the host header template in place of the default', async () => {
    host.customHeader.set(true);
    await type('/templates ');
    expect(header()?.querySelector('[data-slot=back]')).toBeNull();
    expect(header()?.querySelector('strong')?.textContent).toBe('Templates');

    header()!.querySelector<HTMLButtonElement>('.custom-back')!.click();
    await fixture.whenStable();
    expect(host.state()?.level).toBe(1);
  });

  it('says so when the source fails, in the words it is given', async () => {
    await type('/broken ');
    expect(status().textContent).toBe('Searching…');
    failBroken(new Error('503'));
    await Promise.resolve();
    await fixture.whenStable();
    expect(status().textContent).toBe('Couldn’t load suggestions');
    expect(host.state()?.open).toBe(true);
  });

  describe('announcing', () => {
    const land = async () => {
      pageRequests.at(-1)!.resolve();
      await Promise.resolve();
      await fixture.whenStable();
    };

    it('keeps the visible line from screen readers and speaks through its own region', async () => {
      await type('/templates zzz');
      expect(status().getAttribute('aria-hidden')).toBe('true');
      expect(status().hasAttribute('role')).toBe(false);
      expect(announcer().getAttribute('data-slot')).toBe('announcer');
      expect(announcer().textContent).toBe('No results');
    });

    it('counts the rows of a list that is in, and goes quiet when the menu closes', async () => {
      await type('/head');
      expect(announcer().textContent).toBe('3 results');
      await type('ing 2');
      expect(announcer().textContent).toBe('1 result');
      await keydown('Escape');
      expect(announcer().textContent).toBe('');
    });

    it('does not say "searching" over stale rows: they stay, dimmed, and the count stands', async () => {
      await type('/remote ');
      expect(status().textContent).toBe('Searching…');
      await land();
      expect(announcer().textContent).toBe('2 results');

      await type('r');
      expect(host.state()?.stale).toBe(true);
      expect(status().textContent).toBe('');
      expect(status().hasAttribute('data-empty')).toBe(true);
      expect(listbox().getAttribute('data-stale')).toBe('true');
      expect(announcer().textContent).toBe('2 results');
    });

    it('waits for the typing to settle before it speaks', async () => {
      host.announceDelay.set(40);
      await fixture.whenStable();
      host.editor.exec((state, dispatch) => {
        dispatch?.(state.tr.insertText('/head'));
        return true;
      });
      TestBed.tick();
      expect(options()).toHaveLength(3);
      expect(announcer().textContent).toBe('');

      await new Promise((resolve) => setTimeout(resolve, 80));
      await fixture.whenStable();
      expect(announcer().textContent).toBe('3 results');
    });
  });

  describe('placement', () => {
    it('stays hidden until the rows are rendered, then shows in place', async () => {
      expect(menu.style.visibility).not.toBe('visible');
      await type('/head');
      expect(menu.style.visibility).toBe('visible');
      expect(menu.style.left).toMatch(/px$/);
      expect(menu.style.top).toMatch(/px$/);
      expect(host.coordsAtPos).toHaveBeenCalled();
    });

    it('hides again when the session ends', async () => {
      await type('/head');
      await keydown('Escape');
      expect(menu.style.visibility).toBe('hidden');
    });

    it('does not measure again for an arrow press — nothing about the box changed', async () => {
      await type('/head');
      host.coordsAtPos.mockClear();
      await keydown('ArrowDown');
      await keydown('ArrowDown');
      expect(host.state()?.activeIndex).toBe(2);
      expect(host.coordsAtPos).not.toHaveBeenCalled();
    });

    it('measures again when the rows change', async () => {
      await type('/head');
      host.coordsAtPos.mockClear();
      await type('ing 2');
      expect(options()).toHaveLength(1);
      expect(host.coordsAtPos).toHaveBeenCalledTimes(1);
    });
  });

  describe('paging', () => {
    const end = () => menu.querySelector<HTMLElement>('[data-slot=end]')!;
    const observer = () => FakeIntersectionObserver.last!;
    const land = async () => {
      pageRequests.at(-1)!.resolve();
      await Promise.resolve();
      await fixture.whenStable();
    };

    it('watches the end marker, inside the listbox, only while a page can load', async () => {
      await type('/remote ');
      expect(pageRequests).toHaveLength(1);
      expect(observer().options.root).toBe(listbox());
      expect(end().parentElement).toBe(listbox());
      expect(end().getAttribute('aria-hidden')).toBe('true');
      // First page still out: nothing to ask for yet.
      expect(observer().watched.has(end())).toBe(false);

      await land();
      expect(host.state()?.hasMore).toBe(true);
      expect(observer().watched.has(end())).toBe(true);
    });

    it('asks for the next page when the marker comes into view, saying so meanwhile', async () => {
      await type('/remote ');
      await land();

      observer().intersect();
      await fixture.whenStable();
      expect(pageRequests.map((r) => r.cursor)).toEqual([null, '1']);
      expect(status().textContent).toBe('Loading more…');
      expect(observer().watched.has(end())).toBe(false);

      await land();
      expect(options().map((option) => option.textContent?.trim())).toEqual([
        'Row 0.0',
        'Row 0.1',
        'Row 1.0',
        'Row 1.1',
      ]);
      expect(status().textContent).toBe('');
      // Re-armed for the page after.
      expect(observer().watched.has(end())).toBe(true);
    });

    it('marks the listbox busy while a page is out', async () => {
      await type('/remote ');
      expect(listbox().getAttribute('aria-busy')).toBe('true');
      await land();
      expect(listbox().hasAttribute('aria-busy')).toBe(false);
    });

    it('stops watching once the last page is in', async () => {
      await type('/remote ');
      await land();
      for (let page = 1; page <= 2; page++) {
        observer().intersect();
        await fixture.whenStable();
        await land();
      }
      expect(options()).toHaveLength(6);
      expect(host.state()?.hasMore).toBe(false);
      expect(observer().watched.has(end())).toBe(false);
    });
  });
});
