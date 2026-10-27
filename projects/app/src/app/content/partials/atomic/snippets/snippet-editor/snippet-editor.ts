import {
  Component,
  DestroyRef,
  ElementRef,
  ResourceSnapshot,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';

// Library
import { InlineImages, PlaceholderWords } from '@h-k-dev/angular-email-editor';
import { TranslatePipe } from '@ngx-translate/core';

import { Snippet, Snippets } from '../../../../../core/email/snippets';
import { Viewport } from '../../../../../core/layout/viewport';
import { Paper } from '../../../../../core/theme/paper';
import { I18n } from '../../../../../core/translations/i18n';
import { PageHeader } from '../../../common/page-header/page-header';
import { EmailCompose } from '../../../shared/email/email-compose/email-compose';
import { SnippetShelf } from '../snippet-shelf';

/** How long the writing must stop before it is saved, ms. */
const SAVE_REST = 800;

/**
 * One snippet, open — the snippets page's routed pane (`/snippets/:id`):
 * its name, and its text in the composer on the snippet kit
 * (`format="snippet"`): words and their formatting, lists and merge tags,
 * and nothing a message is laid out with. Notion's way of keeping it:
 * saved as the writing stops, the header saying so — no Save to forget
 * before the next snippet is opened; leaving with a change still waiting
 * saves it on the way out. Deleted from the header, with a moment to take
 * it back.
 */
@Component({
  selector: 'app-snippet-editor',
  imports: [TranslatePipe, MatIcon, MatIconButton, MatTooltip, PageHeader, EmailCompose],
  templateUrl: './snippet-editor.html',
  styleUrl: './snippet-editor.scss',
  // One inline image registry per composer — the kit has no images, but
  // the composer asks for one.
  providers: [InlineImages],
})
export class SnippetEditor {
  readonly #store = inject(Snippets);
  readonly #shelf = inject(SnippetShelf);
  readonly #i18n = inject(I18n);
  readonly #route = inject(ActivatedRoute);
  readonly #router = inject(Router);
  readonly #snackBar = inject(MatSnackBar);

  /** The snippet's id — the route's `:id`. */
  readonly id = input.required<string>();

  /** The paper it is written on: the editor's. */
  protected readonly paper = inject(Paper).scheme;

  /** The header leads with the way back to the list on a phone, where the
      snippet is a page of its own. */
  protected readonly backButton = inject(Viewport).compact;

  readonly #loaded = resource({
    params: () => this.id(),
    loader: ({ params, abortSignal }) => this.#store.findById(params, abortSignal),
  });

  /** The snippet on screen — held while a load is open: opening another
      keeps the last one's sheet until the next one lands, so the pane swaps
      in place instead of blanking and growing back. On the status, not
      `value ?? previous`: an id the store has no snippet by, or a failed
      load, clears it (→ `missing`). */
  protected readonly snippet = linkedSignal<
    ResourceSnapshot<Snippet | null | undefined>,
    Snippet | null
  >({
    source: this.#loaded.snapshot,
    computation: (snapshot, previous) => {
      if (snapshot.status === 'loading' || snapshot.status === 'reloading')
        return previous?.value ?? null;
      return snapshot.status === 'error' ? null : (snapshot.value ?? null);
    },
  });

  /** The snippet, as a list of one: its composer is its own, made anew for
      each snippet opened — its undo history never reaches into another's. */
  protected readonly open = computed(() => {
    const snippet = this.snippet();
    return snippet ? [snippet] : [];
  });

  /** The store has no snippet by this id. */
  protected readonly missing = computed(
    () =>
      (this.#loaded.status() === 'resolved' && this.#loaded.value() === null) ||
      this.#loaded.status() === 'error',
  );

  /** Its name and text as written. */
  protected readonly name = linkedSignal(() => this.snippet()?.name ?? '');
  protected readonly html = linkedSignal(() => this.snippet()?.html ?? '');

  /** What the store holds of it, as last saved. */
  readonly #saved = linkedSignal(() => this.snippet());

  /** A save under way. */
  protected readonly saving = signal(false);

  /** The written differs from the stored. */
  protected readonly dirty = computed(() => {
    const saved = this.#saved();
    return !!saved && (this.name() !== saved.name || this.html() !== saved.html);
  });

  /** What the header says of it: being saved, or saved — nothing while
      nothing was ever written. */
  protected readonly status = computed(() =>
    this.saving() || this.dirty() ? 'snippets.saving' : this.#wrote() ? 'snippets.saved' : null,
  );

  /** Something was written since the snippet opened. */
  readonly #wrote = linkedSignal(() => {
    this.snippet();
    return false;
  });

  /** The words on an empty line, in the language in use. */
  protected readonly placeholders = computed<PlaceholderWords>(() => {
    const list = this.#i18n.t('editor.placeholder.list');
    return {
      line: this.#i18n.t('snippets.placeholder'),
      bulletList: list,
      orderedList: list,
    };
  });

  protected readonly nameField = viewChild<ElementRef<HTMLInputElement>>('nameField');

  /** The changes waiting for the writing to stop, and their timer. */
  #pending: Snippet | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // A change waits for the writing to stop, then goes to the store. The
    // composer's own first publish — its canonical form of what it was
    // given — is a change only where the store held another form.
    effect(() => {
      const saved = this.#saved();
      const name = this.name();
      const html = this.html();
      untracked(() => {
        if (!saved || (name === saved.name && html === saved.html)) return;
        this.#wrote.set(true);
        this.#schedule({ id: saved.id, name, html });
      });
    });

    // A nameless snippet — one just made — opens with the caret in its name.
    afterRenderEffect({
      write: () => {
        const field = this.nameField()?.nativeElement;
        const snippet = this.snippet();
        if (field && snippet && !snippet.name && !snippet.html) untracked(() => field.focus());
      },
    });

    // Leaving — another snippet, another page — saves what is waiting.
    inject(DestroyRef).onDestroy(() => void this.#flush());
  }

  protected rename(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  /** Enter in the name goes on into the text. */
  protected nameKey(event: KeyboardEvent, compose: EmailCompose): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    compose.focusEditor();
  }

  /** Back to the list: the snippet closed, the page's own path. */
  protected back(): void {
    void this.#router.navigate(['..'], { relativeTo: this.#route });
  }

  /** Out of the store, with a moment to take it back — as a new snippet
      with what it held. */
  protected async remove(): Promise<void> {
    const snippet = this.snippet();
    if (!snippet) return;
    clearTimeout(this.#timer);
    this.#pending = null;
    const kept = { name: this.name(), html: this.html() };
    await this.#store.remove(snippet.id);
    this.#shelf.removed(snippet.id);
    void this.#router.navigate(['..'], { relativeTo: this.#route });
    this.#snackBar
      .open(this.#i18n.t('snippets.deleted'), this.#i18n.t('snippets.undo'), { duration: 4000 })
      .onAction()
      .subscribe(async () => {
        const made = await this.#shelf.create(kept);
        void this.#router.navigate(['/snippets', made.id]);
      });
  }

  /** Ctrl/⌘+S: what is waiting goes now. */
  protected saveNow(event: Event): void {
    event.preventDefault();
    void this.#flush();
  }

  #schedule(snippet: Snippet): void {
    // Another snippet's changes go first, at once.
    if (this.#pending && this.#pending.id !== snippet.id) void this.#flush();
    this.#pending = snippet;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#flush(), SAVE_REST);
  }

  async #flush(): Promise<void> {
    clearTimeout(this.#timer);
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    this.saving.set(true);
    try {
      const stored = await this.#store.save(pending);
      this.#shelf.saved(stored);
      // Still the snippet open: what it was saved as is the clean state.
      if (this.#saved()?.id === stored.id) this.#saved.set(stored);
    } catch {
      this.#snackBar.open(this.#i18n.t('snippets.saveFailed'), undefined, { duration: 6000 });
    } finally {
      this.saving.set(false);
    }
  }
}
