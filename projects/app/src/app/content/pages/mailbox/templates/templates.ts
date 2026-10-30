import { Component, Injector, computed, inject, resource, signal } from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslatePipe } from '@ngx-translate/core';

import { HueOf, tintOf } from '../../../partials/common/hue-of/hue-of';
import { Examples, ExampleSet } from '../../../../core/email/examples';
import { Filter, escapeLike } from '../../../../core/email/loopback-filter';
import { DIALECT_NAMES, EmailTemplate, Templates } from '../../../../core/email/templates';
import { Viewport } from '../../../../core/layout/viewport';
import { PageScroller } from '../../../../core/router/page-scroller';
import { I18n } from '../../../../core/translations/i18n';
import {
  TemplateCard,
  TemplateCardModel,
} from '../../../partials/atomic/templates/template-card/template-card';
import {
  TemplateAddSet,
  openTemplateAdd,
} from '../../../partials/atomic/templates/template-add/template-add';
import { openTemplateDesigner } from '../../../partials/atomic/templates/template-designer/open-template-designer';
import { OverflowRow } from '../../../partials/common/overflow-row/overflow-row';
import { PageHeader } from '../../../partials/common/page-header/page-header';
import {
  VirtualGrid,
  VirtualGridItem,
  VirtualGridPlaceholder,
} from '../../../partials/common/virtual-grid/virtual-grid';

/** Templates a page of the feed asks the store for — the composer's
    Templates menu pages the same. */
const PAGE_SIZE = 12;

/** A shelf over the feed — every template, or one set's. */
interface Shelf {
  readonly id: string;
  /** The set's key; null for all of them. */
  readonly key: string | null;
  readonly label: string;
  readonly pressed: boolean;
}

/** Every `{{ … }}` written, each counted once. */
const mergeTagsIn = (html: string): number =>
  new Set(html.match(/\{\{[^{}]*\}\}/g)?.map((tag) => tag.replace(/\s+/g, ''))).size;

/**
 * The template gallery, YouTube's home feed: every template the store holds
 * (`Templates` — the composer's Templates menu reads the same store), a
 * card each with its thumbnail, in a grid that draws only the rows in view
 * (`virtual-grid`) and asks for the next page as its end comes near — a
 * page of skeletons under the feed while it loads (the grid's placeholders,
 * in the card's shape). Each card's wash is its template's colour. A thumbnail is drawn
 * only once its card is looked at (`*gridSeen`). The shelves over the feed
 * narrow it to one set, as YouTube's chips do. A card opens a new message
 * on its template. The header's + makes a new one — named, on a set — and
 * opens it in the designer.
 */
@Component({
  selector: 'app-template-gallery',
  imports: [
    TranslatePipe,
    MatIconButton,
    MatIcon,
    MatTooltip,
    HueOf,
    PageHeader,
    OverflowRow,
    VirtualGrid,
    VirtualGridItem,
    VirtualGridPlaceholder,
    TemplateCard,
  ],
  templateUrl: './templates.html',
  styleUrl: './templates.scss',
})
export class TemplateGallery {
  readonly #templates = inject(Templates);
  readonly #examples = inject(Examples);
  readonly #i18n = inject(I18n);
  readonly #scroller = inject(PageScroller);
  readonly #injector = inject(Injector);

  /** A touch screen scrolls the shelves with a finger: no paddles, no drag. */
  protected readonly touch = inject(Viewport).touch;

  /** The sets the store's templates come from: the catalogue's with a
      dialect. */
  readonly #sets = resource({
    loader: async () => (await this.#examples.sets()).filter((set) => set.dialect),
  });

  /** The set on the shelf, or null for every template. */
  protected readonly shelf = signal<string | null>(null);

  protected readonly shelves = computed<readonly Shelf[]>(() => {
    const shelf = this.shelf();
    return [
      { id: 'all', key: null, label: this.#i18n.t('templates.all'), pressed: shelf === null },
      ...(this.#sets.value() ?? []).map((set) => ({
        id: set.key,
        key: set.key,
        label: this.#setLabel(set),
        pressed: shelf === set.key,
      })),
    ];
  });

  /** The templates come so far, in the store's order. */
  readonly #rows = signal<readonly EmailTemplate[]>([]);
  readonly #loading = signal(false);
  /** The store has no more for this shelf. */
  readonly #done = signal(false);
  #request: AbortController | null = null;

  /** Each template's merge tags, counted once — read from its HTML. */
  readonly #mergeTags = new Map<string, number>();

  /** The feed: a card per template come. */
  protected readonly cards = computed<readonly TemplateCardModel[]>(() => {
    const sets = new Map((this.#sets.value() ?? []).map((set) => [set.key, set]));
    const cards = this.#rows().map((template): TemplateCardModel => {
      const key = template.id.split('/')[0];
      const set = sets.get(key);
      const label = set ? this.#setLabel(set) : key;
      return {
        id: template.id,
        template,
        set: label,
        mergeTags: this.#mergeTagsOf(template),
        dialect: DIALECT_NAMES[template.dialect],
      };
    });
    return cards;
  });

  /** A page more than has come while the next is on its way: the grid draws
      the skeletons for it. */
  protected readonly total = computed(() =>
    this.#loading() ? this.#rows().length + PAGE_SIZE : undefined,
  );

  /** A card's wash: its template's colour, the avatar's. */
  protected readonly tint = (card: TemplateCardModel): string => tintOf(card.template.name);

  protected readonly loading = this.#loading.asReadonly();

  /** The shelf holds nothing. */
  protected readonly empty = computed(() => this.#done() && this.#rows().length === 0);

  /** A shelf pressed: the feed starts over on it, from the top. */
  protected pick(key: string | null): void {
    if (key === this.shelf()) return;
    this.shelf.set(key);
    this.#restart();
    this.#scroller.scrollToPosition([0, 0]);
  }

  /** The sets a new template can join: the shelves' own. */
  protected readonly addSets = computed<readonly TemplateAddSet[]>(() =>
    (this.#sets.value() ?? []).map((set) => ({
      key: set.key,
      label: this.#setLabel(set),
      dialect: set.dialect!,
    })),
  );

  /** The header's +: a new template, named, on the shelf in view (the
      first set on All) — the feed reads again, so it stands in its place,
      and it opens in the designer. */
  protected async add(): Promise<void> {
    const sets = this.addSets();
    if (!sets.length) return;
    const created = await openTemplateAdd(this.#injector, {
      sets,
      set: this.shelf() ?? sets[0].key,
    });
    if (!created) return;
    this.#restart();
    const ref = await openTemplateDesigner(this.#injector, created);
    const saves = ref.componentInstance.saved.subscribe((template) => this.patch(template));
    ref.afterClosed().subscribe(() => saves.unsubscribe());
  }

  /** The feed from its start: what is on its way dropped, the grid asks
      for the first page again. */
  #restart(): void {
    this.#request?.abort();
    this.#request = null;
    this.#rows.set([]);
    this.#done.set(false);
    this.#loading.set(false);
  }

  /** The feed's end is near (the grid asks): the next page — unless one is
      on its way, or there is none. */
  protected async more(): Promise<void> {
    if (this.#loading() || this.#done()) return;
    const request = (this.#request = new AbortController());
    this.#loading.set(true);
    const shelf = this.shelf();
    const filter: Filter<EmailTemplate> = {
      where: shelf ? { id: { like: `${escapeLike(shelf)}/%` } } : undefined,
      order: 'name ASC',
      skip: this.#rows().length,
      limit: PAGE_SIZE,
    };
    try {
      const page = await this.#templates.find(filter, request.signal);
      this.#rows.update((rows) => [...rows, ...page]);
      this.#done.set(page.length < PAGE_SIZE);
    } catch {
      // Aborted: the shelf changed under it, and the new one asks for
      // itself. Anything else — the store is away: the feed ends there.
      if (!request.signal.aborted) this.#done.set(true);
    } finally {
      if (this.#request === request) {
        this.#request = null;
        this.#loading.set(false);
      }
    }
  }

  /** A template saved in the designer: its card redrawn as stored, in
      place — the feed is not asked again. */
  protected patch(template: EmailTemplate): void {
    this.#mergeTags.delete(template.id);
    this.#rows.update((rows) => rows.map((row) => (row.id === template.id ? template : row)));
  }

  /** A set's name in the language in use; the catalogue's where the
      dictionary has none. */
  #setLabel(set: ExampleSet): string {
    return this.#i18n.lookup(`templates.sets.${set.key}`) ?? set.label;
  }

  #mergeTagsOf(template: EmailTemplate): number {
    let count = this.#mergeTags.get(template.id);
    if (count === undefined) {
      count = mergeTagsIn(template.html);
      this.#mergeTags.set(template.id, count);
    }
    return count;
  }
}
