import {
  Component,
  DestroyRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationSkipped, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { PageScroller } from '../../../../core/router/page-scroller';
import { DocSection } from '../doc-page/doc';

/** How far past where a jump lands the reading line runs, px: the heading
    a jump brings up is past it, the next one down is not. */
export const READING_SLACK = 8;

let nextId = 0;

/**
 * A page's table of contents, shadcn's: "On this page", then every
 * heading as a link to its #fragment, a level in by depth — and the one
 * being read set apart.
 *
 *     <nav docToc [entries]="toc"></nav>
 *
 * What is being read: the last heading whose top has passed the reading
 * line — where a jump lands (the heading's own `scroll-margin`, a sticky
 * header included) and a few px more — so after a jump it is the one
 * jumped to, never the short one under it. At the foot of the page, where
 * the last few never reach the line, the one jumped to wins while it shows.
 *
 * The page scrolls in `PageScroller`'s sheet; the headings are found by id
 * in the document, after the render that put them there, and again
 * whenever the entries change.
 *
 * Accessibility: a `nav` named by its visible title; the levels are real
 * nested lists; the one being read — the deepest that applies — is
 * `aria-current="location"`, and only it.
 */
@Component({
  selector: 'nav[docToc]',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './doc-toc.html',
  styleUrl: './doc-toc.scss',
  host: { '[attr.aria-labelledby]': 'entries().length ? titleId : null' },
})
export class DocToc {
  readonly entries = input<readonly DocSection[]>([]);

  protected readonly titleId = `doc-toc-title-${nextId++}`;

  /** The section being read, and the topic within it. */
  readonly #section = signal<string | null>(null);
  readonly #topic = signal<string | null>(null);

  /** The one entry set apart: the deepest that applies. */
  protected readonly current = computed(() => this.#topic() ?? this.#section());

  readonly #router = inject(Router);
  readonly #scroller = inject(PageScroller);

  /** The #fragment last jumped to, until the reader scrolls on their own. */
  #jumped: string | null = null;

  /** Works out what is being read, once per frame at most. */
  #schedule = () => {};

  constructor() {
    // A jump — an entry, a heading's link, a link from elsewhere, the same
    // entry pressed again. The router's scroll follows a frame later.
    this.#router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (!(event instanceof NavigationEnd || event instanceof NavigationSkipped)) return;
      this.#jumped = this.#router.parseUrl(event.url).fragment;
      this.#schedule();
    });

    afterRenderEffect((onCleanup) => {
      onCleanup(this.#spy(this.entries()));
    });

    inject(DestroyRef).onDestroy(() => (this.#schedule = () => {}));
  }

  #spy(entries: readonly DocSection[]): () => void {
    const scroller = this.#scroller.scroller;
    const doc = scroller.ownerDocument;
    const view = doc.defaultView;
    const find = (id: string) => doc.getElementById(id);

    // In document order — the entries'.
    const sections: [HTMLElement, string][] = [];
    const topics: [HTMLElement, string][] = [];
    const sectionOf = new Map<string, string>();
    for (const section of entries) {
      const element = find(section.id);
      if (element) sections.push([element, section.id]);
      for (const topic of section.topics ?? []) {
        const element = find(topic.id);
        if (element) topics.push([element, topic.id]);
        sectionOf.set(topic.id, section.id);
      }
    }
    const first = sections[0]?.[0];
    // Where a jump lands, under the scroller's top: the headings share one
    // scroll-margin (a sticky header's height in it).
    const margin =
      first && view ? parseFloat(view.getComputedStyle(first).scrollMarginTop) || 0 : 0;
    const isDocument = scroller === doc.scrollingElement;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = isDocument ? 0 : scroller.getBoundingClientRect().top;
      const line = top + margin + READING_SLACK;
      const passed = (of: [HTMLElement, string][]) => {
        let id: string | null = null;
        for (const [element, key] of of) {
          if (element.getBoundingClientRect().top > line) break;
          id = key;
        }
        return id;
      };
      let section = passed(sections);
      let topic = passed(topics);

      // The foot of the page: what was jumped to, while it shows.
      const atFoot = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const jumped = this.#jumped;
      const target = jumped ? find(jumped) : null;
      if (atFoot && jumped && target) {
        const box = target.getBoundingClientRect();
        const shows = box.bottom > top + margin && box.top < (view?.innerHeight ?? Infinity);
        if (shows && sectionOf.has(jumped)) {
          section = sectionOf.get(jumped)!;
          topic = jumped;
        } else if (shows && sections.some(([, key]) => key === jumped)) {
          section = jumped;
          topic = null;
        }
      }
      // A topic counts only inside the section being read.
      if (topic && sectionOf.get(topic) !== section) topic = null;
      this.#section.set(section);
      this.#topic.set(topic);
    };

    const schedule = () => {
      if (!frame && view) frame = view.requestAnimationFrame(measure);
    };
    // The reader moving the page themselves: the jump is behind them.
    const own = () => (this.#jumped = null);
    const owns = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    // The document's own scroller says so on the window.
    const scrolls: EventTarget | null = isDocument ? view : scroller;

    scrolls?.addEventListener('scroll', schedule, { passive: true });
    view?.addEventListener('resize', schedule, { passive: true });
    for (const type of owns) scroller.addEventListener(type, own, { passive: true });
    this.#schedule = schedule;
    measure();

    return () => {
      if (frame) view?.cancelAnimationFrame(frame);
      scrolls?.removeEventListener('scroll', schedule);
      view?.removeEventListener('resize', schedule);
      for (const type of owns) scroller.removeEventListener(type, own);
      this.#schedule = () => {};
    };
  }
}
