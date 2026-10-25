import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DocSection } from '../../../partials/common/doc-page/doc';
import { DocPage } from '../../../partials/common/doc-page/doc-page';
import { DocProse } from '../../../partials/common/doc-page/doc-prose';
import { API_SECTIONS } from './api-reference.content';

/**
 * The API reference page: the library's public surface, a section per
 * thing a host does — mount an editor, pick a kit, add menus, move
 * documents in and out, hand a send payload to a transport. Each export
 * says where it is imported from, its signature, what it is for in a
 * sentence, and what to know in points. The content is
 * `api-reference.content.ts`; the styling side lives on its own page.
 */
@Component({
  selector: 'app-api-reference',
  imports: [RouterLink, DocPage, DocProse],
  templateUrl: './api-reference.html',
})
export class ApiReference {
  protected readonly sections = API_SECTIONS;

  /** Every section, its exports under it. */
  protected readonly toc: readonly DocSection[] = API_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    topics: section.entries.map((entry) => ({ id: entry.id, title: entry.name, code: true })),
  }));
}
