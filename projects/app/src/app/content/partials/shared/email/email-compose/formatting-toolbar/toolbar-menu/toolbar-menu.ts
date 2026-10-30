import {
  Component,
  Directive,
  ElementRef,
  Injector,
  TemplateRef,
  afterNextRender,
  computed,
  contentChildren,
  inject,
  input,
  output,
  viewChild,
  viewChildren,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

// Material
import { MatIconModule } from '@angular/material/icon';

// Aria
import { Menu, MenuItem, MenuTrigger } from '@angular/aria/menu';

// CDK
import { InputModalityDetector } from '@angular/cdk/a11y';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  CdkConnectedOverlay,
  ConnectedPosition,
  FlexibleConnectedPositionStrategy,
  OverlayModule,
} from '@angular/cdk/overlay';

import { Router, RouterLink } from '@angular/router';

import { PaperIslandScheme } from '../../../paper-island';

/** A row of a toolbar menu. */
export interface ToolbarMenuItem<V> {
  value: V;
  label: string;
  /** A leading glyph — the ⋯ menu's items carry their button's. */
  icon?: string;
  /** A leading dot of this colour — a colour menu's items (the calendar's
      event colours). Decoration: the label names the colour. */
  swatch?: string;
  /** `radio`: one of a set, ticked at the item's end (font, size).
      `checkbox`: a toggle (a moved Bold) — ticked at its end too where it
      has no icon (the calendar's Show weekends). Plain otherwise. */
  kind?: 'radio' | 'checkbox';
  checked?: boolean;
  disabled?: boolean;
  /** Starts a new group: a separator stands before it. */
  separated?: boolean;
  /** Starts a new group under this heading — the ⋮ menu's View. */
  section?: string;
  /** Sets the label in this font — the font menu previews its stacks. */
  font?: string;
  /** Small letters at the item's end, before its tick, each lit or dimmed —
      the font menu's G A O: which mail clients draw the face. Decoration:
      `badgesTitle` says it in words, as a tooltip. */
  badges?: readonly { text: string; on: boolean }[];
  badgesTitle?: string;
  /** A place: the item is a link to it (`routerLink`), not a choice. */
  link?: string;
  /** The place you are in — a link's: `aria-current="page"`, in the
      active wash (the aside's own); the menu opens with it level with the
      trigger (`anchor: 'selected'`). */
  current?: boolean;
  /** The key that does the same outside the menu, at the item's end —
      the calendar's views, Google's D W M. Said to assistive tech as
      `aria-keyshortcuts`. */
  shortcut?: string;
  /** The keys as assistive tech has them (`aria-keyshortcuts`: Meta+C,
      Control+C), where what is shown is not that (⌘C) — else `shortcut`. */
  shortcutKeys?: string;
}

/**
 * A row of the menu's own, after its items: not an item but a control —
 * the ⋮ menu's View and Theme toggles, each with its word. The menu
 * renders the rows in order, each under the heading it is given, if any; a
 * click in one is not a choice, so the menu stays open, and the keys the
 * control acts on are its own — Up and Down move between rows (and up to
 * the items). A menu with no items puts focus on the first row's tab stop
 * when it opens.
 *
 * ```html
 * <div toolbar-menu …>
 *   <ng-template [toolbarMenuRow]="'Appearance'">
 *     <hk-tgb …>…</hk-tgb>
 *   </ng-template>
 * </div>
 * ```
 */
@Directive({ selector: 'ng-template[toolbarMenuRow]' })
export class ToolbarMenuRow {
  /** The row's heading, as a section's. */
  readonly heading = input<string | undefined>(undefined, { alias: 'toolbarMenuRow' });
  readonly template = inject(TemplateRef);
}

/**
 * A toolbar's dropdown menu: an Aria menu in a CDK overlay, opened by the
 * `ngMenuTrigger` it is given and anchored to it.
 *
 * ```html
 * <button ngMenuTrigger #trigger="ngMenuTrigger" [menu]="fonts.menu()">Font</button>
 * <div toolbar-menu #fonts [trigger]="trigger" label="Font" [items]="…" (selected)="…"></div>
 * ```
 *
 * The host takes no room (`display: contents`): it is only where the overlay
 * is declared, so it can stand anywhere in a row without adding a gap. The
 * menu opens above the toolbar (which sits under the text, and on the
 * keyboard on a phone), below when there is no room above — or the other
 * way round, for a trigger on a bar that heads its sheet (`side`).
 */
@Component({
  selector: 'div[toolbar-menu]',
  imports: [
    MatIconModule,
    Menu,
    MenuItem,
    NgTemplateOutlet,
    OverlayModule,
    PaperIslandScheme,
    RouterLink,
  ],
  templateUrl: './toolbar-menu.html',
  styleUrl: './toolbar-menu.scss',
})
export class ToolbarMenu<V> {
  readonly trigger = input.required<MenuTrigger<V>>();
  readonly label = input.required<string>();
  /** The menu's items. None for a menu of rows alone (`ToolbarMenuRow`). */
  /** The menu's items. None for a menu of rows alone (`ToolbarMenuRow`). */
  readonly items = input<readonly ToolbarMenuItem<V>[]>([]);
  /** Which edge of the trigger the menu lines up with — `end` for a ⋯ at a
      line's end. */
  readonly align = input<'start' | 'end'>('start');

  /** Which side of the trigger the menu tries first — the other when there
      is no room: `above` for a bar under the text, `below` for one heading
      the sheet, `after` beside it (a rail's flyout: its top level with the
      trigger's, its bottom where there is no room below). */
  readonly side = input<'above' | 'below' | 'after'>('above');

  /** What the menu is drawn on: the app's solid menu surface, or `glass` —
      see-through and blurring the page under it (a rail's flyout, the
      aside's places over the page). */
  readonly surface = input<'solid' | 'glass'>('solid');

  /** Where the menu opens: beside the trigger (`trigger`, `side` and
      `align` say which way), or over it with the checked item's leading
      mark exactly on the trigger (`selected`) — a select's: the button and
      the item it stands for are one place, so the eye does not travel (the
      calendar's colour menu, its dot on the event's dot). Opening `after`
      the trigger, `selected` keeps beside it, the checked item — or the
      place you are in — level with it (the rail's places). With nothing
      checked, it opens as `trigger` would. */
  readonly anchor = input<'trigger' | 'selected'>('trigger');

  /** An item was chosen. The menu has closed and focus is back on the
      trigger. */
  readonly selected = output<V>();

  readonly #router = inject(Router);
  /** A link item was clicked: its link follows itself (`routerLink`). */
  protected clicked = false;

  /** An item was chosen: said — and a link chosen by key followed, since
      the menu keeps Enter (and Space) from the link. */
  protected onSelected(value: V): void {
    const link = this.items().find((item) => item.value === value)?.link;
    if (link && !this.clicked) void this.#router.navigateByUrl(link);
    this.clicked = false;
    this.selected.emit(value);
  }

  /** The Aria menu, for the trigger's `[menu]`. It renders inside the
      overlay, so it only exists while open. */
  readonly menu = viewChild<Menu<V>>(Menu);

  /** The host's own rows, in order (`ToolbarMenuRow`). */
  protected readonly rows = contentChildren(ToolbarMenuRow, { descendants: true });

  /** Where the rows are rendered, while open. */
  private readonly rowBoxes = viewChildren<ElementRef<HTMLElement>>('rowBox');

  readonly #injector = inject(Injector);

  protected readonly positions = computed<ConnectedPosition[]>(() => {
    // Over the trigger, its top-left on the trigger's: the checked item is
    // brought onto it once the menu can be measured (`onAttach`).
    if (this.anchor() === 'selected' && this.side() !== 'after') {
      return [{ originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'top' }];
    }
    if (this.side() === 'after') {
      return [
        { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 8 },
        { originX: 'end', originY: 'bottom', overlayX: 'start', overlayY: 'bottom', offsetX: 8 },
      ];
    }
    const x = this.align();
    const above: ConnectedPosition = {
      originX: x,
      originY: 'top',
      overlayX: x,
      overlayY: 'bottom',
      offsetY: -4,
    };
    const below: ConnectedPosition = {
      originX: x,
      originY: 'bottom',
      overlayX: x,
      overlayY: 'top',
      offsetY: 4,
    };
    return this.side() === 'above' ? [above, below] : [below, above];
  });

  /** The menu opened. The trigger puts focus on the first item — a menu of
      rows alone has none, so focus goes to the first row's tab stop
      instead, or it would stay on the trigger and Tab would walk out of the
      menu. */
  protected onAttach(): void {
    if (this.anchor() === 'selected') this.#overChecked();
    if (this.items().length) return;
    afterNextRender({ write: () => this.#focusRow(0) }, { injector: this.#injector });
  }

  /** Up and Down between rows, as between items: a row's control keeps the
      arrows across for itself. Past the first row Up is the menu's — to
      its items, where it has some. */
  protected stepRow(event: Event, index: number, by: 1 | -1): void {
    const next = index + by;
    if (next < 0 || next >= this.rowBoxes().length) return;
    event.preventDefault();
    event.stopPropagation();
    this.#focusRow(next);
  }

  private readonly overlay = viewChild(CdkConnectedOverlay);

  readonly #modality = inject(InputModalityDetector);
  /** How the menu is being used — `keyboard`, `mouse`, `touch` — on the
      menu as `data-modality`: opened by the pointer, the checked row (where
      the keyboard starts) is not lit until a key or the pointer reaches
      it. */
  protected readonly modality = toSignal(this.#modality.modalityChanged, {
    initialValue: this.#modality.mostRecentModality,
  });

  /**
   * `anchor: 'selected'`: moves the open menu so the checked item's leading
   * mark (a swatch, an icon — else the item) is centred on the trigger, and
   * puts the keyboard there. Measured by layout offsets, not boxes: the
   * menu is mid-entrance (scaled, shifted), and offsets ignore that. Done
   * as the menu attaches, before its first paint — no jump.
   */
  #overChecked(): void {
    const ref = this.overlay()?.overlayRef;
    const pane = ref?.overlayElement;
    const item = pane?.querySelector<HTMLElement>(
      '.toolbar-menu__item:is([aria-checked="true"], [aria-current="page"])',
    );
    // Nothing to line up: as `trigger` would, out of its top start corner.
    if (pane && !item)
      pane
        .querySelector<HTMLElement>('.toolbar-menu')
        ?.style.setProperty('transform-origin', '0 0');
    if (!ref || !pane || !item) return;
    const mark =
      item.querySelector<HTMLElement>('.toolbar-menu__swatch, mat-icon:not([data-slot])') ?? item;
    let x = mark.offsetWidth / 2;
    let y = mark.offsetHeight / 2;
    for (
      let el: HTMLElement | null = mark;
      el && el !== pane;
      el = el.offsetParent as HTMLElement
    ) {
      x += el.offsetLeft;
      y += el.offsetTop;
      // An offset starts inside its parent's border (a glass menu's
      // hairline): the border counts too.
      const parent = el.offsetParent as HTMLElement | null;
      if (parent) {
        x += parent.clientLeft;
        y += parent.clientTop;
      }
    }
    const origin = this.trigger().element;
    const box = origin.getBoundingClientRect();
    // Where the menu's top-left would stand with the mark on the trigger —
    // then kept on screen (8px in), as a select's list is: near an edge it
    // gives up the alignment by as little as it must.
    const margin = 8;
    const fit = (start: number, size: number, room: number) =>
      Math.min(Math.max(start, margin), Math.max(margin, room - margin - size));
    // Beside the trigger (`side: 'after'`): only level with it.
    const left =
      this.side() === 'after'
        ? box.right + 8
        : fit(box.left + origin.offsetWidth / 2 - x, pane.offsetWidth, innerWidth);
    const top = fit(box.top + origin.offsetHeight / 2 - y, pane.offsetHeight, innerHeight);
    const strategy = ref.getConfig().positionStrategy as FlexibleConnectedPositionStrategy;
    strategy.withPositions([
      {
        originX: 'start',
        originY: 'top',
        overlayX: 'start',
        overlayY: 'top',
        offsetX: left - box.left,
        offsetY: top - box.top,
      },
    ]);
    ref.updatePosition();
    // It grows out of the row on the trigger — over it, from the mark;
    // beside it, from its edge at the row (the CDK's origin, set by the
    // update above, is the box's corner).
    const panel = pane.querySelector<HTMLElement>('.toolbar-menu');
    if (panel) panel.style.transformOrigin = `${this.side() === 'after' ? 0 : x}px ${y}px`;
    afterNextRender({ write: () => this.#activate(item) }, { injector: this.#injector });
  }

  private readonly menuItems = viewChildren(MenuItem);

  /** Makes `element`'s item the menu's active one — Aria's own, so focus
      and the keys start there (Down goes to the item after it). Aria has no
      public way to say where a menu starts; its menu's pattern (typed,
      `_pattern`) does, and focuses the item with it. */
  #activate(element: HTMLElement): void {
    const item = this.menuItems().find((one) => one.element === element);
    const menu = this.menu();
    if (item && menu) menu._pattern.listBehavior.goto(item._pattern);
    else element.focus();
  }

  /** Puts focus on a row's tab stop. */
  #focusRow(index: number): void {
    this.rowBoxes()[index]?.nativeElement.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }
}
