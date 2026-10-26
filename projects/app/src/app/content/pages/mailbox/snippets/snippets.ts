import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';

import { filter } from 'rxjs';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslatePipe } from '@ngx-translate/core';

import {
  INBOX_LIST_MAX,
  Preferences,
  SNIPPET_EDITOR_MIN,
  SNIPPET_LIST_MIN,
} from '../../../../core/storages/preferences';
import { Paper } from '../../../../core/theme/paper';
import { SplitHandle } from '../../../partials/common/split-handle/split-handle';
import { SnippetShelf } from '../../../partials/atomic/snippets/snippet-shelf';
import { PageHeader } from '../../../partials/common/page-header/page-header';
import { PaperIslandDirective } from '../../../partials/shared/email/paper-island';

/**
 * The snippets: pieces of formatted text kept to drop into any message at
 * the caret (the composer's `/` menu, Snippets) — where a template is a
 * whole message to start from. Words read in a list, not a picture in a
 * grid: so the inbox's two halves — the list (names and their words, a
 * search over both) and the open snippet beside it in a routed pane
 * (`/snippets/:id`, `SnippetEditor`), written on the editor's paper with
 * the snippet kit. On a phone the open snippet takes the list's place.
 */
@Component({
  selector: 'app-snippets',
  imports: [
    TranslatePipe,
    MatIcon,
    MatIconButton,
    MatTooltip,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    SplitHandle,
    PageHeader,
    PaperIslandDirective,
  ],
  templateUrl: './snippets.html',
  styleUrl: './snippets.scss',
  // The list: this page's, shared with the editor it routes to (which
  // tells it what it saved).
  providers: [SnippetShelf],
  host: {
    '[style.--snippets-list-width.px]': 'listWidth()',
    '[attr.data-editing]': 'editing() || null',
  },
})
export class SnippetsPage {
  readonly #shelf = inject(SnippetShelf);
  readonly #route = inject(ActivatedRoute);
  readonly #router = inject(Router);

  /** The paper the snippet is written on: the editor's. */
  protected readonly paper = inject(Paper).scheme;

  /** The grid the divider resizes: this page. */
  protected readonly grid = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** How wide the list is, px — its divider, dragged; kept across reloads. */
  protected readonly listWidth = inject(Preferences).snippetListWidth;
  protected readonly listMin = SNIPPET_LIST_MIN;
  protected readonly listMax = INBOX_LIST_MAX;
  /** The open snippet's least width: the divider stops there. */
  protected readonly editorMin = SNIPPET_EDITOR_MIN;

  protected readonly rows = this.#shelf.rows;
  protected readonly query = this.#shelf.query;
  protected readonly settled = this.#shelf.settled;

  /** What the list says when it holds nothing: none written yet, or none
      for the search. */
  protected readonly empty = computed(() => {
    if (!this.settled() || this.rows().length) return null;
    return this.query().trim() ? 'snippets.noMatch' : 'snippets.none';
  });

  /** Whether a snippet is open in the pane: on a phone, the pane then takes
      the list's place. */
  protected readonly editing = signal(false);

  /** A new snippet on its way to the store. */
  protected readonly creating = signal(false);

  protected search(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** A new snippet: stored at once, nameless and empty, and opened — the
      caret in its name. */
  protected async create(): Promise<void> {
    this.creating.set(true);
    try {
      const made = await this.#shelf.create({ name: '', html: '' });
      await this.#router.navigate([made.id], { relativeTo: this.#route, state: { fresh: true } });
    } finally {
      this.creating.set(false);
    }
  }

  constructor() {
    // The navigation that made this page, and every one that ends here: from
    // one snippet to the next the router keeps the editor and only its
    // `:id` changes, so the outlet activates nothing.
    this.#opened();
    this.#router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.#opened());
  }

  #opened(): void {
    this.editing.set(!!this.#route.snapshot.firstChild?.paramMap.get('id'));
  }
}
