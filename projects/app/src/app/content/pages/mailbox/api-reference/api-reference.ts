import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DocSection } from '../../../partials/common/doc-page/doc';
import { DocPage } from '../../../partials/common/doc-page/doc-page';
import { DocProse } from '../../../partials/common/doc-page/doc-prose';
import { API_PAGE_CONTENT } from './api-reference.content';
import { API_PAGES } from './api-pages';

/**
 * A page of the API reference (`/api/:page`): a few sections of the
 * library's public surface, each export with where it is imported from,
 * its signature, what it is for in a sentence, and what to know in points.
 * The aside lists the pages (`API_PAGES`); the content is
 * `api-reference.content.ts`; the styling side has pages of its own.
 */
@Component({
  selector: 'app-api-reference',
  imports: [RouterLink, DocPage, DocProse],
  templateUrl: './api-reference.html',
})
export class ApiReference {
  /** The route's `:page` — always one of `API_PAGES` (the route checks). */
  readonly page = input.required<string>();

  protected readonly content = computed(
    () => API_PAGE_CONTENT.find((page) => page.id === this.page()) ?? API_PAGE_CONTENT[0],
  );
  protected readonly link = computed(
    () => API_PAGES.find((page) => page.id === this.content().id) ?? API_PAGES[0],
  );
  protected readonly trail = computed(() => ['app.nav.api', this.link().key]);

  /** A page of several sections lists them, their exports under them; a
      page of one lists its exports. */
  protected readonly toc = computed<readonly DocSection[]>(() => {
    const sections = this.content().sections;
    const exports = (section: (typeof sections)[number]) =>
      section.entries.map((entry) => ({ id: entry.id, title: entry.name, code: true }));
    if (sections.length === 1) return exports(sections[0]);
    return sections.map((section) => ({
      id: section.id,
      title: section.title,
      topics: exports(section),
    }));
  });
}
