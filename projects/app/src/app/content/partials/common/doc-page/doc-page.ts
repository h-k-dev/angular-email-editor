import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

import { DocToc } from '../doc-toc/doc-toc';
import { PageHeader } from '../page-header/page-header';
import { DocSection } from './doc';

/**
 * A reference page, Linear's docs: a small trail at the top left saying
 * where you are — held at the top while the page scrolls under it — the
 * page in one reading column, and, once the page has the room, its table
 * of contents beside it (`DocToc`), held in view too.
 *
 *     <doc-page icon="api" [trail]="['app.nav.api', 'app.nav.apiPages.editor']" [toc]="toc">
 *       <h1 class="doc-title">…</h1>
 *       …sections, each with the id its toc entry names…
 *     </doc-page>
 *
 * Every entry is a link to its #fragment: the router scrolls there — the
 * heading landing just under the header (`--doc-header` in its
 * scroll-margin) — and back returns to where the page was left
 * (`PageScroller`).
 */
@Component({
  selector: 'doc-page',
  imports: [MatIcon, TranslatePipe, PageHeader, DocToc],
  templateUrl: './doc-page.html',
  styleUrl: './doc-page.scss',
})
export class DocPage {
  /** The page's icon — the aside's, for the same place. */
  readonly icon = input.required<string>();
  /** Where the page is, as translation keys: its group, then itself. */
  readonly trail = input.required<readonly string[]>();
  readonly toc = input<readonly DocSection[]>([]);
}
