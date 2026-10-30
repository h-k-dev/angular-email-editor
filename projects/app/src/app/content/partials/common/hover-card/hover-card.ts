import { Directionality } from '@angular/cdk/bidi';
import {
  ConnectedPosition,
  OverlayRef,
  createCloseScrollStrategy,
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
} from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import {
  DestroyRef,
  Directive,
  ElementRef,
  Injectable,
  InjectionToken,
  Injector,
  TemplateRef,
  ViewContainerRef,
  booleanAttribute,
  computed,
  debounced,
  effect,
  inject,
  input,
  numberAttribute,
  signal,
  untracked,
} from '@angular/core';

/** Where the card stands, matTooltip's words: `before` / `after` follow the
    writing direction, `left` / `right` do not. */
export type HoverCardPosition = 'above' | 'below' | 'before' | 'after' | 'left' | 'right';

/** Every card's defaults, as `MAT_TOOLTIP_DEFAULT_OPTIONS` is the tooltip's. */
export interface HoverCardDefaultOptions {
  /** How long the pointer rests on the trigger before the card comes, ms. */
  showDelay: number;
  /** How long the card stays once the pointer has left trigger and card —
      the time to cross the gap into it, ms. */
  hideDelay: number;
  position: HoverCardPosition;
}

export const HOVER_CARD_DEFAULT_OPTIONS = new InjectionToken<HoverCardDefaultOptions>(
  'HOVER_CARD_DEFAULT_OPTIONS',
  { providedIn: 'root', factory: () => ({ showDelay: 500, hideDelay: 300, position: 'below' }) },
);

/** The gap between trigger and card, px. */
const GAP = 4;

/** A card the service shows. */
export interface HoverCardOpen {
  /** Whom the card belongs to, from {@link HoverCards.open}. */
  readonly owner: object;
  /** The pane the card is drawn in (the pointer is watched on it). */
  readonly pane: HTMLElement;
  /** Takes the card away (it leaves as every card does). */
  close(): void;
}

/**
 * The hover cards, app-wide: one card at a time — a new one takes the
 * place of whichever is up. A card is a template drawn on a surface of its
 * own beside its trigger (an overlay), interactive (unlike a tooltip: the
 * pointer may go into it, a link in it is clicked), gone on scroll and on
 * Escape. Its look is global (styles/_hover-card.scss, `hover-card`); it
 * comes and goes with the app's motion.
 *
 * The {@link HoverCard} directive is the way to one; this is what it uses.
 */
@Injectable({ providedIn: 'root' })
export class HoverCards {
  readonly #injector = inject(Injector);
  readonly #dir = inject(Directionality, { optional: true });
  #current: (HoverCardOpen & { ref: OverlayRef }) | null = null;

  /** Shows `content` beside `origin`; `closed` is called once it has gone,
      for whatever reason (closed, another card, a scroll, Escape). */
  open(
    owner: object,
    origin: HTMLElement,
    content: TemplatePortal,
    options: { position: HoverCardPosition; panelClass?: string | string[]; closed: () => void },
  ): HoverCardOpen {
    this.#current?.close();
    const rtl = this.#dir?.value === 'rtl';
    const ref = createOverlayRef(this.#injector, {
      positionStrategy: createFlexibleConnectedPositionStrategy(this.#injector, origin)
        .withPositions(positionsFor(options.position, rtl))
        .withFlexibleDimensions(false)
        .withViewportMargin(8),
      scrollStrategy: createCloseScrollStrategy(this.#injector),
      panelClass: ['hover-card', 'motion-enter', ...[options.panelClass ?? []].flat()],
    });
    ref.attach(content);

    let gone = false;
    const done = () => {
      if (gone) return;
      gone = true;
      if (this.#current === card) this.#current = null;
      ref.dispose();
      options.closed();
    };
    const card = {
      owner,
      ref,
      pane: ref.overlayElement,
      close: () => {
        if (gone || this.#current !== card) return done();
        this.#current = null;
        // It leaves as every card does (styles/_motion.scss), then goes.
        const pane = ref.overlayElement;
        pane.classList.replace('motion-enter', 'motion-leave');
        pane.addEventListener('animationend', done, { once: true });
        setTimeout(done, 200);
      },
    };
    // A scroll takes it at once (the close strategy detaches it).
    ref.detachments().subscribe(done);
    ref.keydownEvents().subscribe((event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      card.close();
    });
    this.#current = card;
    return card;
  }

  /** Takes away the card up now — `owner`'s only, when one is given. */
  close(owner?: object): void {
    if (owner && this.#current?.owner !== owner) return;
    this.#current?.close();
  }
}

/** Where the card goes, then where it goes when that has no room: the
    other side. Above and below it lines up with the trigger's start. */
function positionsFor(position: HoverCardPosition, rtl: boolean): ConnectedPosition[] {
  const below: ConnectedPosition = {
    originX: 'start',
    originY: 'bottom',
    overlayX: 'start',
    overlayY: 'top',
    offsetY: GAP,
  };
  const above: ConnectedPosition = {
    originX: 'start',
    originY: 'top',
    overlayX: 'start',
    overlayY: 'bottom',
    offsetY: -GAP,
    panelClass: 'motion-above',
  };
  const right: ConnectedPosition = {
    originX: 'end',
    originY: 'center',
    overlayX: 'start',
    overlayY: 'center',
    offsetX: GAP,
  };
  const left: ConnectedPosition = {
    originX: 'start',
    originY: 'center',
    overlayX: 'end',
    overlayY: 'center',
    offsetX: -GAP,
  };
  switch (position) {
    case 'above':
      return [above, below];
    case 'below':
      return [below, above];
    case 'left':
      return [left, right];
    case 'right':
      return [right, left];
    case 'before':
      return rtl ? [right, left] : [left, right];
    case 'after':
      return rtl ? [left, right] : [right, left];
  }
}

/**
 * A hover card — matTooltip's way, a card's content: the pointer resting
 * on the host shows the template beside it after `hoverCardShowDelay`; it
 * stays while the pointer is on the host or in the card, and goes
 * `hoverCardHideDelay` after it has left both (time to cross into it).
 * Escape, a scroll or another card take it at once.
 *
 *     <input [hoverCard]="place" hoverCardPosition="below" [hoverCardDisabled]="!typing()" />
 *     <ng-template #place><a href="…">Open in Google Maps</a></ng-template>
 *
 * Disabled, it does not come — and one that is up goes, unless the pointer
 * is in it (a click in the card that takes focus from the host keeps it).
 * Touch is not hovering: a tap shows nothing. `show()` / `hide()` do it by
 * hand. Defaults: {@link HOVER_CARD_DEFAULT_OPTIONS}.
 */
@Directive({
  selector: '[hoverCard]',
  exportAs: 'hoverCard',
  host: {
    '(pointerenter)': 'enter($event)',
    '(pointerleave)': 'onTrigger.set(false)',
  },
})
export class HoverCard {
  readonly #defaults = inject(HOVER_CARD_DEFAULT_OPTIONS);
  readonly #cards = inject(HoverCards);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #view = inject(ViewContainerRef);

  /** What the card shows. */
  readonly hoverCard = input.required<TemplateRef<unknown>>();
  readonly hoverCardPosition = input<HoverCardPosition>(this.#defaults.position);
  readonly hoverCardDisabled = input(false, { transform: booleanAttribute });
  readonly hoverCardShowDelay = input(this.#defaults.showDelay, {
    transform: (value: unknown) => numberAttribute(value, this.#defaults.showDelay),
  });
  readonly hoverCardHideDelay = input(this.#defaults.hideDelay, {
    transform: (value: unknown) => numberAttribute(value, this.#defaults.hideDelay),
  });
  /** Classes on the card's pane, as `matTooltipClass`. */
  readonly hoverCardClass = input<string | string[]>([]);

  protected readonly onTrigger = signal(false);
  readonly #onCard = signal(false);
  /** By hand: `show()`. */
  readonly #forced = signal(false);
  /** Taken away (Escape, a scroll, another card, `hide()`): not back until
      the pointer comes again. */
  readonly #dismissed = signal(false);

  /** Asked for, now. */
  readonly #wanted = computed(
    () =>
      !this.#dismissed() &&
      (this.#forced() || this.#onCard() || (this.onTrigger() && !this.hoverCardDisabled())),
  );
  /** …after the wait: the show delay in, the hide delay out. */
  readonly #settled = debounced(this.#wanted, (wanted) => {
    const wait = wanted ? this.hoverCardShowDelay() : this.hoverCardHideDelay();
    return wait > 0 ? new Promise<void>((resolve) => setTimeout(resolve, wait)) : undefined;
  });

  /** Whether the card is up. Taken away or disabled, it goes at once. */
  readonly visible = computed(
    () =>
      !!this.#settled.value() &&
      !this.#dismissed() &&
      (this.#forced() || this.#onCard() || !this.hoverCardDisabled()),
  );

  #card: HoverCardOpen | null = null;

  constructor() {
    effect(() => {
      const visible = this.visible();
      untracked(() => (visible ? this.#open() : this.#close()));
    });
    inject(DestroyRef).onDestroy(() => this.#close());
  }

  /** Shows the card now. */
  show(): void {
    this.#dismissed.set(false);
    this.#forced.set(true);
  }

  /** Takes the card away now. */
  hide(): void {
    this.#forced.set(false);
    this.#dismissed.set(true);
  }

  protected enter(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    this.#dismissed.set(false);
    this.onTrigger.set(true);
  }

  #open(): void {
    if (this.#card) return;
    const card = this.#cards.open(
      this,
      this.#host,
      new TemplatePortal(this.hoverCard(), this.#view),
      {
        position: this.hoverCardPosition(),
        panelClass: this.hoverCardClass(),
        // Gone while still ours: taken away.
        closed: () => {
          if (this.#card !== card) return;
          this.#card = null;
          this.#onCard.set(false);
          this.hide();
        },
      },
    );
    card.pane.addEventListener('pointerenter', () => this.#onCard.set(true));
    card.pane.addEventListener('pointerleave', () => this.#onCard.set(false));
    this.#card = card;
  }

  #close(): void {
    this.#forced.set(false);
    if (!this.#card) return;
    this.#card = null;
    this.#onCard.set(false);
    this.#cards.close(this);
  }
}
