import {
  DestroyRef,
  Service,
  TemplateRef,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';

// CDK
import { ConnectedPosition } from '@angular/cdk/overlay';

// Library
import { AnchorRect } from 'angular-email-editor/anchor';

/** Above the anchor, centred; below when there is no room above. The bubble
    menu's, the link and alt-text editors': what floats over a selection
    must not cover the line being read. */
export const POPOVER_ABOVE: ConnectedPosition[] = [
  { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
  { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
];

/** Below the anchor, centred; above when there is no room below. The block
    menu's: it describes the whole block, and under it never covers the
    first row while writing. */
export const POPOVER_BELOW: ConnectedPosition[] = [
  { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
  { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
];

/**
 * A panel of the composer's one popover: a floating piece of chrome — the
 * bubble menu over a selection, the block menu under a layout block, a
 * grip's row menu, the link and alt-text editors — as the popover sees it.
 * The panel says when it wants to show, where, and with what; the popover
 * decides which of them is up (see {@link Popover}).
 *
 * Everything is read reactively, so a panel hands over its signals as they
 * are: an extension's state, a `viewChild`, a `computed`.
 */
export interface PopoverPanel {
  /** Toolbars stand under dialogs: a link editor opened from the bubble
      menu takes the popover, and the bubble has it back — if it is still
      open — once the editor is gone. */
  readonly layer: 'toolbar' | 'dialog';
  /** Whether the panel wants to show. */
  open(): boolean;
  /** Where it stands: a box in viewport coordinates — a selection's, a
      block's, a grip's, an image's. */
  anchor(): AnchorRect | null | undefined;
  /** Its content; `undefined` until the panel's own view has it. */
  content(): TemplateRef<unknown> | undefined;
  /** Where the popover goes for the anchor, first choice first. */
  positions(): ConnectedPosition[];
  /** A key pressed while this panel is up — in the popover, or in the
      editor beneath it: the popover hears every key of the page while it
      is open, so Escape closes a dialog from wherever the caret is. */
  onKeydown?(event: KeyboardEvent): void;
  /** A click outside the popover while this panel is up. */
  onOutsideClick?(event: MouseEvent): void;
}

/** What the outlet hands the service: its overlay's element, when there is
    one. */
export interface PopoverOutletRef {
  pane(): HTMLElement | null;
}

/**
 * The composer's one popover, shared by everything that floats over the
 * text. There used to be one CDK overlay per menu — the bubble menu, the
 * block menu, the table grip's menu, the link editor, the alt-text editor —
 * each with an anchor and a position strategy of its own, and each landing
 * afresh whenever its neighbour closed: pass an image by one character
 * with Shift-Arrow and the image's bubble popped in over the text's, then
 * the text's popped back. Now the popover is one element that stays up
 * while *any* panel wants to show, and only its content and its anchor
 * change: a bubble turning from the image's tools into the text's is a
 * swap inside the same box, and the link editor opening from the bubble's
 * own button replaces it in place.
 *
 * Which panel is up is derived, never told: the open one in the top layer
 * — dialogs over toolbars — and among several open in that layer, the one
 * that opened last. A panel that closes gives the popover back to whatever
 * is still open, and when nothing is, the popover goes. No order of events
 * can put two up together, or leave one up with nothing in it.
 *
 * Provided by the composer (`EmailCompose`), beside its formatting
 * commands; the panels register from their constructors, and the outlet
 * (`PopoverOutlet`) renders. Only the *arbitration* lives here — each
 * menu keeps its own reasons to open, its keys and its focus rules.
 */
@Service({ autoProvided: false })
export class Popover {
  readonly #panels = signal<readonly PopoverPanel[]>([]);

  readonly #outlet = signal<PopoverOutletRef | null>(null);

  /** The panels that want to show, in registration order. */
  readonly #open = computed(() => this.#panels().filter((panel) => panel.open()));

  /**
   * The panel that is up, or null while none is. Dialogs over toolbars;
   * within the layer, the panel that opened most recently — one that opens
   * takes the popover, one that closes gives it back to the one still open.
   */
  readonly shown = linkedSignal<readonly PopoverPanel[], PopoverPanel | null>({
    source: this.#open,
    computation: (open, previous) => {
      const dialogs = open.filter((panel) => panel.layer === 'dialog');
      const top = dialogs.length ? dialogs : open;
      if (!top.length) return null;
      const before = previous?.source ?? [];
      const opened = top.filter((panel) => !before.includes(panel));
      if (opened.length) return opened[opened.length - 1];
      const held = previous?.value;
      return held && top.includes(held) ? held : top[top.length - 1];
    },
  });

  /**
   * Registers a panel, for as long as the registering component lives.
   * Call in an injection context — a menu's constructor.
   */
  register(panel: PopoverPanel): void {
    this.#panels.update((panels) => [...panels, panel]);
    inject(DestroyRef).onDestroy(() =>
      this.#panels.update((panels) => panels.filter((known) => known !== panel)),
    );
  }

  /** The popover's element while it is up, else null — what a panel's
      press-outside test measures against. */
  pane(): HTMLElement | null {
    return this.#outlet()?.pane() ?? null;
  }

  /** Connects the outlet that renders the popover. Called once, as the
      outlet is created. */
  connect(outlet: PopoverOutletRef): void {
    this.#outlet.set(outlet);
  }
}
