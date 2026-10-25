import { Component, ElementRef, afterRenderEffect, inject, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { PageHeader } from '../page-header/page-header';
import { DocSection } from './doc';

/**
 * A reference page, Linear's docs: a small trail at the top left saying
 * where you are, the page in one reading column, and — once the page has
 * the room — its table of contents beside it, held in view while the page
 * scrolls and lit at the section being read.
 *
 *     <doc-page icon="api" [trail]="['app.nav.api', 'app.nav.apiPages.editor']" [toc]="toc">
 *       <h1 class="doc-title">…</h1>
 *       …sections, each with the id its toc entry names…
 *     </doc-page>
 *
 * Every entry is a link to its #fragment: the router scrolls there, and
 * back returns to where the page was left (`PageScroller`). The sections
 * are watched afresh whenever the toc changes — a route that only changes
 * its `:page` keeps the component and swaps what it shows.
 */
@Component({
  selector: 'doc-page',
  imports: [MatIcon, RouterLink, TranslatePipe, PageHeader],
  templateUrl: './doc-page.html',
  styleUrl: './doc-page.scss',
})
export class DocPage {
  /** The page's icon — the aside's, for the same place. */
  readonly icon = input.required<string>();
  /** Where the page is, as translation keys: its group, then itself. */
  readonly trail = input.required<readonly string[]>();
  readonly toc = input<readonly DocSection[]>([]);

  /** The section being read, and the topic within it. */
  protected readonly reading = signal<string | null>(null);
  protected readonly readingTopic = signal<string | null>(null);

  readonly #host: HTMLElement = inject(ElementRef).nativeElement;

  constructor() {
    // After the render that put the toc's sections on the page.
    afterRenderEffect((onCleanup) => {
      this.reading.set(null);
      this.readingTopic.set(null);
      const observer = this.#spy(this.toc());
      onCleanup(() => observer?.disconnect());
    });
  }

  /**
   * Which section is being read: the last one reaching into the top of the
   * view (its upper 40%). Sections are watched as wholes, so a long one
   * stays lit all the way down; between two, the later — the one whose
   * heading just came up.
   */
  #spy(toc: readonly DocSection[]): IntersectionObserver | null {
    if (typeof IntersectionObserver === 'undefined') return null;
    const find = (id: string) => this.#host.querySelector(`#${CSS.escape(id)}`);
    // In document order — the toc's — so "the last one" is a walk.
    const sections = new Map<Element, string>();
    const topics = new Map<Element, string>();
    for (const section of toc) {
      const element = find(section.id);
      if (element) sections.set(element, section.id);
      for (const topic of section.topics ?? []) {
        const element = find(topic.id);
        if (element) topics.set(element, topic.id);
      }
    }
    const seen = new Set<Element>();
    const last = (of: Map<Element, string>) => {
      let id: string | null = null;
      for (const [element, key] of of) if (seen.has(element)) id = key;
      return id;
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) seen.add(entry.target);
          else seen.delete(entry.target);
        }
        // Between two (a gap, the title above the first): the last one lit
        // stays lit.
        const section = last(sections);
        if (section) this.reading.set(section);
        this.readingTopic.set(last(topics));
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    for (const element of [...sections.keys(), ...topics.keys()]) observer.observe(element);
    return observer;
  }
}
