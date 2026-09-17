import {
  Component,
  DestroyRef,
  ElementRef,
  inject,

  // Signals
  afterRenderEffect,
  computed,
  contentChild,
  debounced,
  input,
  linkedSignal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { SuggestionItem, SuggestionMenuState, measureMenuPlacement } from 'angular-email-editor';
import { SuggestionMenuHeader, SuggestionMenuHeaderContext } from './suggestion-menu.slots';

/**
 * A suggestion menu's floating box — the element `createSuggestionMenu` is
 * given, rendered from the state it reports. The extension does the work
 * (finding the trigger, filtering, paging, the keys, placing the box,
 * applying); this gives the state its roles and ids, so the editor's
 * `aria-controls` and `aria-activedescendant` land on real elements, keeps
 * the next page coming as the list scrolls, and says what is going on.
 *
 * **The pair.** The menu is the container; the host renders one
 * `[email-suggestion-menu-item]` per item into it and decides what a row
 * shows (an icon, the title, a detail). Rows are options of the menu's
 * listbox and never take focus: the caret stays in the editor, which is the
 * combobox. One pair serves every trigger — `/`, `{{`, `||` — at once: they
 * never open together, so a menu of several triggers is still one element
 * and one state, which says whose list it is (`trigger`, `label`).
 *
 *     <div email-suggestion-menu #menu [state]="state()">
 *       @for (item of state()?.items; track item.id) {
 *         <div email-suggestion-menu-item [item]="item">{{ item.title }}</div>
 *       }
 *     </div>
 *
 *     createSuggestionMenu({ element: menu, onChange: (s) => state.set(s), triggers: [
 *       { trigger: '/', label: 'Insert block', items: extensionSuggestions },
 *       { trigger: '{{', label: 'Tokens', source: fetchMergeTags },
 *     ] })
 *
 * **Two levels.** Inside a group the menu shows a header above the list — a
 * back button and the group's title by default, or the host's
 * `ng-template[emailSuggestionMenuHeader]` — names the listbox after the
 * group, and says "No results" rather than closing when nothing matches.
 *
 * **Said twice, differently.** What is going on shows as a line under the
 * list, at once. A screen reader hears it from a separate live region that
 * waits for the typing to settle (`announceDelay`) and also counts the
 * results — the highlighted option's id does not change when the list is
 * filtered under it, so nothing else would say the list is a new one.
 *
 * Every word it says is an input, English by default.
 */
@Component({
  selector: '[email-suggestion-menu]',
  imports: [NgTemplateOutlet],
  templateUrl: './suggestion-menu.html',
  styleUrl: './suggestion-menu.scss',
  host: {
    '[attr.data-level]': 'state()?.level ?? 1',
  },
})
export class SuggestionMenu {
  /** The extension's latest state — undefined before the editor mounts. */
  readonly state = input<SuggestionMenuState>();

  /** Names the listbox on level 1 when the open trigger has no `label` of
      its own — a menu of several triggers names each list there ("Insert
      block", "Personalization tokens"); level 2 is named by its group. */
  readonly label = input('Suggestions');
  /** The level-2 back button's accessible name. */
  readonly backLabel = input('Back');
  /** Said while a source is still searching. */
  readonly loadingLabel = input('Searching…');
  /** Said on level 2 when nothing matches. */
  readonly emptyLabel = input('No results');
  /** Said while a further page is on its way. */
  readonly loadingMoreLabel = input('Loading more…');
  /** Said when the source's answer failed. */
  readonly errorLabel = input('Couldn’t load suggestions');
  /** Announced once a list is in: how many rows it has. */
  readonly resultsLabel = input<(count: number) => string>((count) =>
    count === 1 ? '1 result' : `${count} results`,
  );
  /** Milliseconds the announcement waits for the typing to settle, so a
      screen reader hears the list that stayed, not one per letter. Going
      quiet (the menu closes) never waits. 0 announces at once. */
  readonly announceDelay = input(400);
  /** Gap between the trigger's line and the menu, in px. */
  readonly offset = input(4);

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The state's list. The extension reports a new state for every arrow
      press but the same list until it changes — so what hangs off the list
      (the index below, every row's position) sits an arrow press out. */
  readonly #items = computed(() => this.state()?.items);

  /** Each item's position in the list, looked up once per list — rows ask
      by identity, so a list of n rows costs n lookups, not n². */
  readonly #indices = computed(
    () => new Map(this.#items()?.map((item, index) => [item, index]) ?? []),
  );

  /** The keyboard-highlighted row's index; -1 before there is a state. */
  readonly activeIndex = computed(() => this.state()?.activeIndex ?? -1);

  /** The extension's id for the option at an index — the same function for
      the menu's whole life. */
  readonly optionId = computed(() => this.state()?.optionId);

  /** Where `item` sits in the current list; -1 when it is not in it. */
  indexOf(item: SuggestionItem): number {
    return this.#indices().get(item) ?? -1;
  }

  protected readonly header = contentChild(SuggestionMenuHeader);
  protected readonly listbox = viewChild.required<ElementRef<HTMLElement>>('listbox');
  protected readonly end = viewChild.required<ElementRef<HTMLElement>>('end');

  /** The group being searched, on level 2. */
  protected readonly parent = computed(() => this.state()?.parent ?? null);

  protected readonly listLabel = computed(
    () => this.parent()?.title ?? this.state()?.label ?? this.label(),
  );

  /** The header template's context, while there is a group to head. */
  protected readonly headerContext = computed((): SuggestionMenuHeaderContext | null => {
    const group = this.parent();
    return group && { $implicit: group, back: this.back, backLabel: this.backLabel() };
  });

  /** The line under the list: failed, searching, loading more, nothing
      found, or nothing. Not "searching" over stale rows — dimmed, they say
      it themselves, and a line that came and went with every keystroke
      would resize the box (and have it placed again) twice per letter. */
  protected readonly status = computed(() => {
    const state = this.state();
    if (!state?.open) return '';
    if (state.error !== null) return this.errorLabel();
    if (state.loading) return state.stale ? '' : this.loadingLabel();
    if (state.loadingMore) return this.loadingMoreLabel();
    if (state.level === 2 && !state.items.length) return this.emptyLabel();
    return '';
  });

  /** What a screen reader should hear next: the status line, or how many
      rows the list has now. While the rows on screen answer the previous
      query there is no news yet — what was said last stands. */
  readonly #announcement = linkedSignal<
    { state: SuggestionMenuState | undefined; status: string; results: (count: number) => string },
    string
  >({
    source: () => ({ state: this.state(), status: this.status(), results: this.resultsLabel() }),
    computation: ({ state, status, results }, previous) => {
      if (!state?.open) return '';
      if (status) return status;
      if (state.loading) return previous?.value ?? '';
      return results(state.items.length);
    },
  });

  /** The announcement, once the typing has settled. */
  protected readonly announced = debounced(this.#announcement, (text) => {
    const delay = this.announceDelay();
    return text && delay > 0
      ? new Promise<void>((resolve) => setTimeout(resolve, delay))
      : undefined;
  });

  /** A page can be asked for right now: more exist and nothing is out. */
  readonly #canLoadMore = computed(() => {
    const state = this.state();
    return !!state?.open && state.hasMore && !state.loading && !state.loadingMore;
  });

  /** What the box's place depends on: where the session starts, and what
      decides its size (rows, header, status line, query). An arrow press
      changes none of it, so it measures nothing. */
  readonly #layout = computed(
    () => {
      const state = this.state();
      if (!state?.open || !state.range) return null;
      return {
        from: state.range.from,
        rows: state.items.length,
        level: state.level,
        query: state.query,
        status: this.status(),
        clientRect: state.clientRect,
        offset: this.offset(),
      };
    },
    {
      equal: (a, b) =>
        a === b ||
        (!!a &&
          !!b &&
          a.from === b.from &&
          a.rows === b.rows &&
          a.level === b.level &&
          a.query === b.query &&
          a.status === b.status &&
          a.offset === b.offset),
    },
  );

  /** What moves the highlight: the row it is on, and the list it is in — a
      level, a query. Null while closed. */
  readonly #highlight = computed(() => {
    const state = this.state();
    return state?.open ? `${state.level}:${state.query}:${state.activeIndex}` : null;
  });

  /** Watches the list's end marker: its coming within two rows of the
      listbox's bottom edge asks for the next page. An observer, not a scroll
      listener — it speaks only when the marker crosses in, so scrolling
      costs nothing. Made on first use: its root is the rendered listbox. */
  #endObserver: IntersectionObserver | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.#endObserver?.disconnect());

    // Watched only while a page can be loaded. Observing afresh reports the
    // marker's current state, so a page too short to fill the box (the
    // marker still in view once it lands) asks for the next one straight
    // away, and a list that scrolls waits for the scroll.
    afterRenderEffect({
      read: () => {
        if (typeof IntersectionObserver === 'undefined') return;
        const canLoad = this.#canLoadMore();
        // Any new list re-arms the watch, not only a longer one: a source
        // that answers at once never passes through `loading`, and its next
        // list can have as many rows as the last.
        this.#items();
        const end = this.end().nativeElement;
        this.#endObserver ??= new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) this.state()?.loadMore();
          },
          { root: this.listbox().nativeElement, rootMargin: '0px 0px 64px 0px' },
        );
        this.#endObserver.unobserve(end);
        if (canLoad) this.#endObserver.observe(end);
      },
    });

    // Placing the box: after its rows are rendered, measured in one phase and
    // written in the next — the plugin never touches the element, so no read
    // follows a write inside a keystroke. Shown only once it is in place.
    afterRenderEffect({
      earlyRead: () => {
        const layout = this.#layout();
        const anchor = layout?.clientRect();
        return layout && anchor ? measureMenuPlacement(anchor, this.#host, layout.offset) : null;
      },
      write: (placement) => {
        const place = placement();
        const style = this.#host.style;
        const visibility = place ? 'visible' : 'hidden';
        if (place) {
          const left = `${place.left}px`;
          const top = `${place.top}px`;
          if (style.left !== left) style.left = left;
          if (style.top !== top) style.top = top;
        }
        if (style.visibility !== visibility) style.visibility = visibility;
      },
    });

    // The highlighted row stays visible as the arrows walk past the fold —
    // one watch for the whole list, not one per row: measured in one phase,
    // scrolled in the next, the listbox only. A new query is a new list
    // (back at its top row); a page landing under a list scrolled by hand is
    // not, and must not pull it back.
    afterRenderEffect({
      earlyRead: () => {
        if (this.#highlight() === null) return null;
        const list = this.listbox().nativeElement;
        const row = list.querySelector<HTMLElement>('[data-active]');
        if (!row) return null;
        const { offsetTop: top, offsetHeight: height } = row;
        const { scrollTop, clientHeight } = list;
        if (top < scrollTop) return { list, scrollTop: top };
        if (top + height > scrollTop + clientHeight) {
          return { list, scrollTop: top + height - clientHeight };
        }
        return null;
      },
      write: (scroll) => {
        const target = scroll();
        if (target) target.list.scrollTop = target.scrollTop;
      },
    });

    // A level starts at its top: entering a group or leaving one does not
    // keep the other list's scroll position.
    afterRenderEffect({
      write: () => {
        this.parent();
        this.listbox().nativeElement.scrollTop = 0;
      },
    });
  }

  protected readonly back = (): void => this.state()?.back();
}
