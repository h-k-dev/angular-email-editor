import { NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  InjectionToken,
  LOCALE_ID,
  OnInit,
  PLATFORM_ID,

  // Signals
  booleanAttribute,
  computed,
  contentChild,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  Attachment,
  AttachmentKind,
  AttachmentStatus,
  attachmentInFlight,
  attachmentKind,
  formatAttachmentSize,
} from './attachment';
import { prefersReducedMotion, scanningState } from './attachment-chip.animation';
import {
  AttachmentChipIcon,
  AttachmentChipIconContext,
  AttachmentChipProgress,
  AttachmentChipProgressContext,
  AttachmentProgressMode,
} from './attachment-chip.slots';

/** A page with its corner folded — the base the document-like kinds draw on. */
const PAGE = 'M3.5 1.5h5.5l3.5 3.5v9.5h-9z M9 1.5v3.5h3.5';

/** One stroked path per kind, on a 16×16 grid, drawn in `currentColor`.
    Our own glyphs rather than an icon font: nothing to load, nothing to
    install, and they take the chip's colour like text does. */
const ICONS: Record<AttachmentKind, string> = {
  file: PAGE,
  document: `${PAGE} M5.5 8h5 M5.5 10h5 M5.5 12h3`,
  pdf: `${PAGE} M5.5 7.5h5v2.5h-5z M5.5 12h5`,
  spreadsheet: `${PAGE} M5.5 7.5h5v5h-5z M5.5 10h5 M8 7.5v5`,
  presentation: `${PAGE} M6 12.5v-2 M8 12.5v-4.5 M10 12.5v-3`,
  archive: `${PAGE} M7 3h1 M8 4.5h1 M7 6h1 M8 7.5h1 M7 10h2v2.5h-2z`,
  image: 'M2.5 3.5h11v9h-11z M2.5 10.5l3-3 3 3 2-2 3 3 M9.5 6a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  video: 'M1.5 4h9v8h-9z M10.5 7l4-2.5v7l-4-2.5',
  audio:
    'M6 12V4l7-1.5v8 M3 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0 M10 10.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0',
  message: 'M1.5 3.5h13v9h-13z M1.5 4l6.5 5 6.5-5',
};

/** How simulated progress paces itself. */
export interface AttachmentChipOptions {
  /** The connection a simulated transfer pretends to have, in bytes per
      second. A fast line by default — the point is the gesture, not a wait. */
  readonly bytesPerSecond: number;
  /** Floor in ms, so a tiny file still shows a visible fill. */
  readonly minDuration: number;
  /** Ceiling in ms, so a large file never makes anyone wait on a fake. */
  readonly maxDuration: number;
  /** Duration in ms for an attachment whose size is unknown. */
  readonly fallbackDuration: number;
  /** How long the full bar stays before the chip settles, in ms — so 100%
      is something the eye gets to see, not a frame on the way out. */
  readonly linger: number;
}

const DEFAULT_OPTIONS: AttachmentChipOptions = {
  bytesPerSecond: 10 * 1024 * 1024,
  minDuration: 400,
  maxDuration: 3000,
  fallbackDuration: 800,
  linger: 600,
};

/** Overrides for simulated progress, app-wide or per subtree:
    `{ provide: ATTACHMENT_CHIP_OPTIONS, useValue: { bytesPerSecond: 2e6 } }`.
    Anything left out keeps its default. */
export const ATTACHMENT_CHIP_OPTIONS = new InjectionToken<Partial<AttachmentChipOptions>>(
  'ATTACHMENT_CHIP_OPTIONS',
  { factory: () => ({}) },
);

/** How long a simulated transfer of `size` bytes runs, in ms: size over the
    assumed speed, clamped to the floor and ceiling. The linger after it is
    not part of this — it is the same for every size. */
export function simulatedDuration(
  size: number | undefined,
  options: Omit<AttachmentChipOptions, 'linger'> = DEFAULT_OPTIONS,
): number {
  if (size == null) return options.fallbackDuration;
  const ms = (size / options.bytesPerSecond) * 1000;
  return Math.min(options.maxDuration, Math.max(options.minDuration, ms));
}

/** What the progress announces itself as, per stage, unless the host says
    otherwise — "Preparing report.pdf". */
const STATUS_LABELS: Record<AttachmentStatus, string> = {
  preprocessing: 'Preparing',
  queued: 'Waiting to upload',
  uploading: 'Uploading',
  postprocessing: 'Processing',
  complete: 'Uploaded',
};

/**
 * One attachment, laid out like a list row with an avatar:
 *
 *     [icon] | name        | [progress / ×]
 *            | size        |
 *     ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
 *
 * Progress is a bar along the bottom edge that fills with the number; with
 * no number the whole chip is swept by a band of light instead, the way a
 * scanner passes over a page — and when the number arrives mid-sweep the
 * band fades out on its way rather than vanishing. The square at the end is
 * shared: while work is in flight it holds the readout (the percentage,
 * nothing while there is none), and the remove button paints over it on
 * hover or focus, always on a touch screen. The chip owns all of that
 * motion: the stylesheet draws it and `attachment-chip.animation.ts` times
 * it; a host only says where the transfer is.
 *
 * **Stages are `status`.** A host with an upload pipeline binds the stage
 * it is in — `preprocessing`, `queued`, `uploading`, `postprocessing`,
 * `complete`, the vocabulary of Uppy and tus — and `progress` (0–1) while
 * uploading. The stages where work runs without a number sweep, the one
 * with a number fills, and `queued` keeps quiet: busy, no bar, no sweep,
 * announced as waiting. The progress names itself after the stage
 * ("Preparing report.pdf") unless `progressLabel` says otherwise. The stage
 * is reflected as `data-status` on the host. Which stages a host has, and
 * in what order, is the host's pipeline; the chip only draws the one it is
 * given.
 *
 * **State is ARIA.** `aria-busy` is reflected while any stage is in flight,
 * and is also an input for a host with no stages to tell: busy with a
 * `progress` fills, busy with `null` sweeps. `aria-disabled` takes the
 * remove button out of play. Both inputs go under their ARIA names, so a
 * host writes `[aria-busy]="upload.pending"` exactly as it would on any
 * element, and the chip reflects them back onto itself — they are the
 * styling hooks too (`[email-attachment-chip][aria-busy='true']`).
 *
 * **`simulateProgress`** is for hosts that already have the bytes and only
 * want the "attaching" moment: the chip runs a fill paced by `size` over
 * `ATTACHMENT_CHIP_OPTIONS`, is busy while it runs and for a moment after
 * the bar is full, and settles on its own.
 * It plays once, when the chip is created; it is skipped for reduced motion
 * and on the server; and a real `status` or `aria-busy` from the host always wins. It
 * never emits and never gates anything — don't use it for work that is
 * really happening but untracked; that is `aria-busy` with no `progress`.
 * The fake announces no number to assistive tech, only that it is busy.
 *
 * **Parts are `data-slot`s.** Every part carries one — `icon`, `label`,
 * `name`, `size`, `trailing`, `progress` (the readout, with
 * `progress-value` inside), `progress-track`, `progress-indicator` (the
 * bar), `remove` — and that is how it is styled from outside:
 * `[email-attachment-chip] [data-slot='name'] { … }`. Theme it through the
 * `--email-*` tokens; a structural override reaches a part with two
 * attributes (`[email-attachment-chip] [data-slot='name'][data-slot]`).
 *
 * **Slots are templates.** `icon` and `progress` are boxes the chip sizes;
 * a host fills either with its own template by marking an `ng-template`
 * `emailAttachmentIcon` / `emailAttachmentProgress` (or the `*` shorthand on
 * the element). The icon box is `--email-attachment-chip-icon-size` square
 * and sets `font-size` and `color` to match, so a `mat-icon` with `inline`, a
 * font icon or an SVG drawn at `1em` all fit with no rule of their own; the
 * template gets the attachment and its `kind`. The progress template gets
 * the attachment, `status`, `progress`, `percent` and `mode`, and replaces
 * only the readout — the bar and the sweep stay the chip's.
 *
 * **It asks, it does not do.** The chip holds no list: `removed` is a
 * request the host answers by dropping the item (and cancelling its upload).
 * Picking, dropping, uploading and assembling the MIME are the host's.
 *
 * Opt-in enter/leave animations ship with it:
 * `animate.enter="email-attachment-chip-enter"` and
 * `animate.leave="email-attachment-chip-leave"` on the chip's element.
 *
 * Meant for an `<li>` inside `<ul email-attachment-chips>`. No Material, no
 * icon font, no headless library.
 */
@Component({
  selector: '[email-attachment-chip]',
  imports: [NgTemplateOutlet],
  templateUrl: './attachment-chip.html',
  styleUrl: './attachment-chip.scss',
  host: {
    '[attr.data-kind]': 'kind()',
    '[attr.data-status]': 'status()',
    '[attr.data-mode]': 'mode()',
    '[attr.data-scanning]': 'scanning()',
    '[attr.aria-busy]': 'busy() || null',
    '[attr.aria-disabled]': 'ariaDisabled() || null',
  },
})
export class AttachmentChip implements OnInit {
  readonly #locale = inject(LOCALE_ID);
  readonly #options = { ...DEFAULT_OPTIONS, ...inject(ATTACHMENT_CHIP_OPTIONS) };
  readonly #browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly #destroyRef = inject(DestroyRef);

  /** The file this chip stands for. A `File` satisfies it as it is. */
  readonly attachment = input.required<Attachment>();

  /** Set false for a read-only message (a sent copy, a preview): the chip
      stays, the remove button goes. */
  readonly removable = input(true, { transform: booleanAttribute });

  /** Prefix for the remove button's accessible name — "Remove report.pdf". */
  readonly removeLabel = input('Remove');

  /** Which stage the transfer is in. `null` for a host with no stages to
      tell — then `aria-busy` and `progress` alone describe the work. */
  readonly status = input<AttachmentStatus | null>(null);

  /** Work is in flight for this attachment (an upload, a download, a scan),
      for a host that has no stages to tell. */
  readonly ariaBusy = input(false, { alias: 'aria-busy', transform: booleanAttribute });

  /** How far the work is, 0–1, while uploading. `null` when there is no
      number. */
  readonly progress = input<number | null>(null);

  /** The remove button is out of play — e.g. while the message sends. */
  readonly ariaDisabled = input(false, { alias: 'aria-disabled', transform: booleanAttribute });

  /** Run a fake transfer once, paced by the attachment's size. */
  readonly simulateProgress = input(false, { transform: booleanAttribute });

  /** Prefix for the progress's accessible name — "Uploading report.pdf".
      Left out, it follows the stage: Preparing, Uploading, Processing. */
  readonly progressLabel = input<string | undefined>(undefined);

  /** The remove button was pressed. The host drops the attachment; the chip
      goes when the host's list no longer has it. */
  readonly removed = output<void>();

  /** The host's own icon, if it handed one in. */
  protected readonly iconTemplate = contentChild(AttachmentChipIcon);

  /** The host's own progress readout, if it handed one in. */
  protected readonly progressTemplate = contentChild(AttachmentChipProgress);

  readonly #simulating = signal(false);

  /** Busy for real (a stage in flight, or the host said so) or for show (a
      simulation running). Public so the container can tell whether any of
      its chips is. */
  readonly busy = computed(
    () => attachmentInFlight(this.status()) || this.ariaBusy() || this.#simulating(),
  );

  /** Which progress to draw, if any: a sweep for a stage with no number, a
      bar for one with, nothing yet for one that waits, and the host's real
      state beats a simulation. Reflected on the host as `data-mode`. */
  protected readonly mode = computed<AttachmentProgressMode | null>(() => {
    const status = this.status();
    if (status === 'preprocessing' || status === 'postprocessing') return 'indeterminate';
    if (status === 'queued') return 'queued';
    if (status === 'uploading' || this.ariaBusy()) {
      return this.progress() == null ? 'indeterminate' : 'determinate';
    }
    return this.#simulating() ? 'simulated' : null;
  });

  /** The scanning band's state on the host — `true` while there is no
      number, `leaving` for a moment after one arrives. */
  protected readonly scanning = scanningState(computed(() => this.mode() === 'indeterminate'));

  /** What the progress is called: the host's word, or the stage's. */
  protected readonly label = computed(
    () => this.progressLabel() ?? STATUS_LABELS[this.status() ?? 'uploading'],
  );

  protected readonly percent = computed(() =>
    Math.round(Math.min(1, Math.max(0, this.progress() ?? 0)) * 100),
  );

  protected readonly kind = computed(() => attachmentKind(this.attachment().type));
  protected readonly icon = computed(() => ICONS[this.kind()]);

  protected readonly iconContext = computed<AttachmentChipIconContext>(() => ({
    $implicit: this.attachment(),
    kind: this.kind(),
  }));

  protected readonly progressContext = computed<AttachmentChipProgressContext>(() => ({
    $implicit: this.attachment(),
    status: this.status(),
    progress: this.progress(),
    percent: this.percent(),
    mode: this.mode() ?? 'indeterminate',
  }));

  protected readonly size = computed(() => {
    const size = this.attachment().size;
    return size == null ? '' : formatAttachmentSize(size, this.#locale);
  });

  protected readonly duration = computed(() =>
    simulatedDuration(this.attachment().size, this.#options),
  );

  ngOnInit(): void {
    if (!this.simulateProgress() || !this.#browser || prefersReducedMotion()) return;
    // A timer, not `animationend`: the bar's CSS animation is only the
    // picture. A tab that never paints must still see the chip settle.
    this.#simulating.set(true);

    const timer = setTimeout(
      () => this.#simulating.set(false),
      this.duration() + this.#options.linger,
    );

    this.#destroyRef.onDestroy(() => clearTimeout(timer));
  }
}
