import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,

  // Signals
  signal,
  viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

// Library
import {
  SourceSearchQuery,
  SourceSearchState,
  createSourceSearch,
} from '@h-k-dev/angular-email-editor/source-tools';
import { HtmlEmailCompose, SourceTool } from '../html-email-compose/html-email-compose';

const CLOSED: SourceSearchState = {
  open: false,
  replace: false,
  query: { text: '' },
  count: 0,
  current: -1,
  error: null,
};

/**
 * VS Code's find widget for an HTML source pane, opt-in: projected into
 * `section[html-email-compose]`, which takes its {@link extension} into
 * the kit (a {@link SourceTool}) — a screen without it never bundles either.
 *
 *     <section html-email-compose>
 *       <div source-search></div>
 *     </section>
 *
 * Mod-F in the source opens it on the selected word, Mod-H with the replace
 * row; Enter / Shift+Enter step, Escape hands the caret back to the source.
 */
@Component({
  selector: 'div[source-search]',
  exportAs: 'sourceSearch',
  imports: [MatIconButton, MatIcon, MatTooltip, TranslatePipe],
  templateUrl: './source-search.html',
  styleUrl: './source-search.scss',
  providers: [{ provide: SourceTool, useExisting: SourceSearch }],
  host: {
    role: 'search',
    '[hidden]': '!state().open',
    '(keydown)': 'onKeydown($event)',
  },
})
export class SourceSearch implements SourceTool {
  readonly #pane = inject(HtmlEmailCompose);
  readonly #injector = inject(Injector);

  protected readonly state = signal(CLOSED);
  protected readonly replacement = signal('');
  private readonly findField = viewChild.required<ElementRef<HTMLInputElement>>('find');
  private readonly replaceField = viewChild<ElementRef<HTMLInputElement>>('replace');

  /** The search for the pane's kit. */
  readonly extension = createSourceSearch({
    onChange: (state) => this.state.set(state),
    onOpen: (replace) =>
      // Once the bar is drawn: a hidden field takes no focus.
      afterNextRender(
        () => {
          const field = replace ? this.replaceField() : this.findField();
          field?.nativeElement.focus();
          field?.nativeElement.select();
        },
        { injector: this.#injector },
      ),
  });

  #run(command: string, ...args: unknown[]): void {
    this.#pane.editor()?.commands[command]?.(...args);
  }

  protected setText(text: string): void {
    this.#run('setSearchQuery', { ...this.state().query, text });
  }

  protected toggle(flag: keyof Omit<SourceSearchQuery, 'text'>): void {
    const query = this.state().query;
    this.#run('setSearchQuery', { ...query, [flag]: !query[flag] });
  }

  protected toggleReplace(): void {
    this.#run('openSearch', !this.state().replace);
  }

  protected next(): void {
    this.#run('findNext');
  }

  protected previous(): void {
    this.#run('findPrevious');
  }

  protected replaceOne(): void {
    this.#run('replaceNext', this.replacement());
  }

  protected replaceAll(): void {
    this.#run('replaceAll', this.replacement());
  }

  /** Closes the bar and hands the caret back — on the match it was on. */
  protected close(): void {
    this.#run('closeSearch');
    this.#pane.editor()?.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (event.key === 'Escape') {
      // The bar's, not the dialog's round it: it would close too.
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === 'Enter' && target === this.findField().nativeElement) {
      event.preventDefault();
      if (event.shiftKey) this.previous();
      else this.next();
    } else if (event.key === 'Enter' && target === this.replaceField()?.nativeElement) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) this.replaceAll();
      else this.replaceOne();
    }
  }
}
