import {
  Component,
  ElementRef,
  Injector,

  // Signals
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';

// Angular CDK
import { CdkTrapFocus } from '@angular/cdk/a11y';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

// Angular Email Editor
import { InlineImages } from '@h-k-dev/angular-email-editor';
import { TranslatePipe } from '@ngx-translate/core';

import { MessageForm } from '../compose/message-form/message-form';
import { IslandMarquee, PaperIsland } from '../compose/paper-island';
import { Viewport } from '../../services/viewport';
import { I18n } from '../../services/i18n';
import { BackButton } from '../../services/back-button';
import {
  ComposeWindow,
  ComposeWindowMobile,
  ComposeWindows,
  DOCK_GAP,
  InlinePart,
  slotPosition,
} from '../../services/compose-windows';

/** How far a press on the title bar travels before it is a drag and no
    longer a click, px. */
const DRAG_THRESHOLD = 4;

/** A press on the title bar that may become a drag. */
interface Grab {
  readonly pointer: number;
  readonly x: number;
  /** Where the window was pinned when pressed — px from the right side of
      the screen, taken from where it actually is, pinned or not. */
  readonly from: number;
  /** The pins that keep the window on screen. */
  readonly min: number;
  readonly max: number;
  moving: boolean;
}

/**
 * One compose window: a title bar, and a message sheet of its own. What the
 * window does is the {@link ComposeWindows} service's — this draws the
 * state it is handed and passes the gestures back:
 *
 * - The title bar names the message by its subject ("New message" before
 *   it has one). A click on it minimizes the window, or restores it, as
 *   Gmail's does — it is a button, so a keyboard gets the same.
 * - Dragging the title bar moves the window along the bottom edge, never
 *   off the screen (ProtonMail's). Not in the dialog, and not on a phone,
 *   where a window is the whole screen.
 * - Expanded, it is a modal dialog: a scrim behind it (the dock's), focus
 *   kept inside, Escape and the scrim bring it back to the edge.
 * - Sent, it closes, and says so; discarded, it closes.
 *
 * The sheet stays mounted whatever the window shows — minimized hides it —
 * so the editor, its history and its uploads are never re-created.
 */
@Component({
  selector: 'section[compose-window]',
  imports: [TranslatePipe, MessageForm, MatIcon, MatIconButton],
  // One inline image registry per composer: this window's message. And
  // the window is a paper island (`scheme`) for everything it holds.
  providers: [InlineImages, { provide: PaperIsland, useExisting: ComposeWindowFrame }],
  hostDirectives: [CdkTrapFocus],
  templateUrl: './compose-window.html',
  styleUrl: './compose-window.scss',
  host: {
    role: 'dialog',
    '[attr.aria-labelledby]': 'bare() ? null : titleId()',
    '[attr.aria-label]': 'bare() ? label() : null',
    '[attr.aria-modal]': 'expanded() || null',
    '[attr.data-mode]': 'window().mode',
    '[attr.data-bare]': 'bare() || null',
    '[class.compose-window--front]': 'front()',
    '[class.compose-window--full]': 'full()',
    '[attr.data-slot]': 'window().slot',
    '[attr.data-paper-scheme]': 'scheme()',
    '[style.--compose-window-x.px]': 'x()',
    '(pointerdown)': 'windows.raise(window().id)',
    '(focusin)': 'windows.raise(window().id)',
    '(keydown.escape)': 'leaveDialog($event)',
  },
})
export class ComposeWindowFrame implements PaperIsland {
  protected readonly windows = inject(ComposeWindows);
  protected readonly i18n = inject(I18n);
  protected readonly viewport = inject(Viewport);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The island's element (`PaperIsland`): the whole window — what spans
      it, the editor's marquee, draws here. */
  readonly element = this.#host.nativeElement;
  /** The island's marquee: the composer in the sheet starts it, the
      writer's empty room asks for it (`MarqueeStart`). */
  readonly marquee = new IslandMarquee();
  readonly #snackBar = inject(MatSnackBar);
  /** This window's inline image registry — the one provided above, so the
      parts of a message put back go in here, and the parts of one closing
      come out of here before it takes them with it. */
  readonly #images = inject(InlineImages);

  /** The window's state, from the service. */
  readonly window = input.required<ComposeWindow>();

  /** How the window shows on a phone: as the page (no title bar of its
      own) or as a window with its bar. The service carries what the opener
      asked for; a host embedding this component sets it directly. */
  readonly mobile = input<ComposeWindowMobile>('page');

  protected readonly titleId = computed(() => `compose-window-title-${this.window().id}`);
  protected readonly minimized = computed(() => this.window().mode === 'minimized');
  protected readonly expanded = computed(
    () => this.window().mode === 'expanded' && !this.viewport.compact(),
  );
  protected readonly front = computed(() => this.windows.front() === this.window().id);

  /** On a phone an open window is the screen: there is no edge to sit on,
      and no room beside it. */
  protected readonly full = computed(() => this.viewport.compact() && !this.minimized());

  /** The phone's page: the screen, and no title bar of its own. The way
      out is the phone's back button, as it is out of any other page. */
  protected readonly bare = computed(() => this.full() && this.mobile() === 'page');

  /** On the edge, where a drag can move it. */
  protected readonly movable = computed(() => !this.expanded() && !this.full());

  /** Where the window sits, as px from the right side of the screen: its
      own place on the edge, worked out from its number, or wherever a drag
      has pinned it instead. The dialog and a phone's full screen lay
      themselves out (they are the screen) and this is simply kept — coming
      back from either puts the window exactly where it was. */
  protected readonly x = computed(() => this.window().pin ?? slotPosition(this.window().slot));

  /** The message this window holds. */
  protected readonly sheet = viewChild(MessageForm);

  /** Zoomed, the window is a document, not a window: a paper island in its
      sheet's Appearance (the ⋮ menu's Light, Dark or App) — title bar,
      writer bar, envelope rows and text one paper, and the menus opened
      from it too (paper-island.ts). On the edge only the text wears it. */
  readonly scheme = computed(() =>
    this.expanded() ? (this.sheet()?.editorScheme() ?? null) : null,
  );

  /** What the window is called: the message's subject, or what an unnamed
      message is called. The title bar shows it; a page, which has no title
      bar, says it to assistive tech instead. */
  protected readonly label = computed(
    () => this.sheet()?.message().subject.trim() || this.i18n.t('composeWindow.new'),
  );

  /** What the sheet starts from: what the window opened with (a reply its
      opener prepared, or a message the forward button put back), else a
      new message. Read once, as the sheet is created — from then on the
      message is the sheet's own. */
  protected readonly seed = computed(() => this.window().restored?.message ?? null);

  #grab: Grab | null = null;

  constructor() {
    // A window that opens with a message: its inline parts go into this
    // window's registry — a new one; a closed window's object URLs died
    // with it — before the editor mounts (a render after the sheet), so
    // every `cid:` resolves as its node view mounts.
    effect(() => {
      const restored = this.window().restored;
      untracked(() => {
        for (const part of restored?.images ?? []) {
          if (!this.#images.blob(part.cid)) this.#images.add(part.blob, part.cid);
        }
      });
    });

    // The dialog keeps focus inside; on the edge, Tab moves on to the page.
    // Trapping or not, the trap places the caret: it captures focus as the
    // window opens — onto what the sheet marks `cdkFocusInitial`, To for a
    // new message, the editor for a reply — and hands it back where it was
    // when the window goes (the CDK's initial focus and its restore; the
    // sheet leaves the caret to it).
    const trap = inject(CdkTrapFocus);
    trap.autoCapture = true;
    effect(() => (trap.enabled = this.expanded()));

    // The phone's back button closes the window instead of leaving the
    // page — whatever it shows there (a page has nothing of its own to
    // leave by; a window has its title bar's close) — and the forward
    // button brings it back, message and all: a back press is a step away
    // from the message, not a decision about it, and the step is taken back
    // the way every other one on a phone is. Closing it by hand is the
    // decision, and the forward button has nothing to give back then (the
    // guard's entry goes with it). Only while the window IS the screen: on
    // a desk, back is the page's.
    const back = inject(BackButton);
    effect((onCleanup) => {
      if (!this.full()) return;
      // Taken as the press closes the window, while the sheet is still
      // there to be read; the forward press comes long after it is gone.
      let closed: ComposeWindow | null = null;
      const held = back.guard({
        // The entry this window came back on, where it did: its guard is
        // still standing there and is taken over, so a message closed and
        // brought back never leaves an entry behind.
        adopt: this.window().guard,
        dismiss: () => {
          closed = this.#snapshot(held.key);
          this.close();
        },
        restore: () => closed && this.windows.reopen(closed),
      });
      onCleanup(held.release);
    });

    // Asked for by name — Compose with three windows already open hands
    // back the oldest. The caret goes in after the window has been drawn
    // open again: a sheet that is still hidden takes no focus.
    const injector = inject(Injector);
    effect(() => {
      // The ask is the only dependency: the window's own state changing —
      // a drag, a mode — must never re-take the caret.
      const wanted = this.windows.wanted();
      untracked(() => {
        if (wanted?.id !== this.window().id) return;
        afterNextRender({ write: () => trap.focusTrap.focusInitialElement() }, { injector });
      });
    });
  }

  protected toggleMinimized(): void {
    const { id } = this.window();
    if (this.minimized()) this.windows.dock(id);
    else this.windows.minimize(id);
  }

  protected toggleExpanded(): void {
    const { id } = this.window();
    if (this.expanded()) this.windows.dock(id);
    else this.windows.expand(id);
  }

  protected close(): void {
    this.windows.close(this.window().id);
  }

  /** The window as it would have to come back: its own state, on the entry
      `guard` sits on, with what is written in it — the message as the sheet
      holds it, and the bytes of the inline parts its HTML names, which the
      registry would otherwise take with it. */
  #snapshot(guard: number): ComposeWindow {
    const message = this.sheet()?.message() ?? null;
    if (!message) return { ...this.window(), guard, restored: null };
    const images = this.#images
      .cids()
      .map((cid) => ({ cid, blob: this.#images.blob(cid) }))
      .filter((part): part is InlinePart => part.blob !== undefined);
    return { ...this.window(), guard, restored: { message, images } };
  }

  /** The sheet sent its message: the window has done its job. */
  protected sent(): void {
    this.#snackBar.open(this.i18n.t('composeWindow.sent'), undefined, {
      duration: 4000,
    });
    this.close();
  }

  /** Escape leaves the dialog for the edge — unless something inside took
      the key first (a menu closing, the editor's own). */
  protected leaveDialog(event: Event): void {
    if (!this.expanded() || event.defaultPrevented) return;
    event.preventDefault();
    this.windows.dock(this.window().id);
  }

  /** A press on the title bar, outside its buttons' own controls: the start
      of a drag, if it travels. The bounds are taken now, from where the
      window actually is — so a window still in the row is picked up exactly
      where it sits, and pinned from there. */
  protected grab(event: PointerEvent): void {
    if (event.button !== 0 || !this.movable()) return;
    if ((event.target as Element).closest('[data-slot="controls"]')) return;
    const rect = this.#host.nativeElement.getBoundingClientRect();
    const screen = this.#host.nativeElement.ownerDocument.documentElement.clientWidth;
    this.#grab = {
      pointer: event.pointerId,
      x: event.clientX,
      from: screen - rect.right,
      // Pinned by its right side: the far end is where its left edge would
      // reach the other side of the screen.
      min: DOCK_GAP,
      max: Math.max(DOCK_GAP, screen - rect.width - DOCK_GAP),
      moving: false,
    };
  }

  /** Past the threshold the press is a drag: the bar captures the pointer
      — so the release lands on the bar and never clicks the title — and
      the window follows it sideways, kept on screen. Dragging pins it: it
      leaves the row and keeps this place whatever the other windows do. */
  protected drag(event: PointerEvent): void {
    const grab = this.#grab;
    if (!grab || event.pointerId !== grab.pointer) return;
    const dx = event.clientX - grab.x;
    if (!grab.moving) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      grab.moving = true;
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    }
    // Pinned from the right, so a drag to the right is a smaller pin.
    const pin = Math.round(Math.min(grab.max, Math.max(grab.min, grab.from - dx)));
    this.windows.pinTo(this.window().id, pin);
  }

  protected drop(event: PointerEvent): void {
    if (this.#grab?.pointer === event.pointerId) this.#grab = null;
  }
}
