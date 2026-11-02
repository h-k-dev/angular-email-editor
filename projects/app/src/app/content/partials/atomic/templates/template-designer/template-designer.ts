import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterNextRender,

  // Signals
  computed,
  effect,
  inject,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

// Angular CDK
import { CdkOverlayOrigin, type ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { DomPortal } from '@angular/cdk/portal';

// Angular Signal Forms
import { FormField, debounce, form, max, min } from '@angular/forms/signals';

// Angular Material
import { MatButton, MatIconButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';

// Angular File Drop
import { AngularFileDrop } from '@h-k-dev/angular-file-drop';

// Angular Email Editor
import {
  InlineImages,
  PAGE_INSET_MAX,
  PAGE_ROW_PADDING_MAX,
  PAGE_SPACING_MAX,
  PAGE_WIDTH_MAX,
  PAGE_WIDTH_MIN,
} from '@h-k-dev/angular-email-editor';
import { atRest, pageLayoutModel } from '@h-k-dev/angular-email-editor/actions';
import {
  createSourceFolding,
  createSourceGutter,
  createSourceKeys,
  createTagMatching,
} from '@h-k-dev/angular-email-editor/source-tools';
import { FieldKeys } from '@h-k-dev/angular-email-editor/keyboard';
import {
  EMAIL_CUSTOM_SWATCHES,
  injectPalette,
  injectSwatches,
  isPaletteColor,
  rememberSwatch,
} from '@h-k-dev/angular-email-editor/palette';
import { AttachmentChip, AttachmentChipIcon } from '@h-k-dev/angular-email-editor/attachment-chip';
import { AttachmentChips } from '@h-k-dev/angular-email-editor/attachment-chips';
import { TranslatePipe } from '@ngx-translate/core';

import { BLANK, Envelope } from '../../../../../core/email/envelope';
import { BackButton } from '../../../../../core/router/back-button';
import { EmailTemplate, Templates } from '../../../../../core/email/templates';
import {
  DESIGNER_DETAILS_MAX,
  DESIGNER_DETAILS_MIN,
  DESIGNER_DETAILS_PUSH_MIN,
  DESIGNER_EDITOR_MIN,
  DESIGNER_PREVIEW_MAX,
  DESIGNER_PREVIEW_MIN,
  DESIGNER_SOURCE_MAX,
  DESIGNER_SOURCE_MIN,
  Preferences,
} from '../../../../../core/storages/preferences';
import { Badge } from '../../../common/badge/badge';
import { GlassGroup } from '../../../common/glass-group/glass-group';
import { MessageImport } from '../../../common/message-import/message-import';
import { DropHint } from '../../../common/drop-hint/drop-hint';
import { PageHeader } from '../../../common/page-header/page-header';
import { PaperToggle } from '../../../common/paper-toggle/paper-toggle';
import { PhoneFrame } from '../../../common/phone-frame/phone-frame';
import { MailView } from '../../../shared/email/mail-view/mail-view';
import { ScrollOwner } from '../../../../../core/directives/scroll-owner/scroll-owner';
import { SplitHandle } from '../../../common/split-handle/split-handle';
import { EmailCompose } from '../../../shared/email/email-compose/email-compose';
import { ColorPalette } from '../../../shared/email/email-compose/formatting-toolbar/color-palette/color-palette';
import { HtmlEmailCompose } from '../../../shared/email/html-email-compose/html-email-compose';
import { SourceSearch } from '../../../shared/email/source-search/source-search';
import {
  AddressRow,
  EnvelopeRows,
} from '../../../shared/email/message-form/envelope-rows/envelope-rows';
import { MessageSettingsButton } from '../../../shared/email/message-form/message-settings-button/message-settings-button';
import { EditorView, MessageSheet } from '../../../shared/email/message-form/message-sheet';
import { releaseEditingSurface } from '../../../shared/email/is-typing';
import {
  IslandMarquee,
  MarqueeStart,
  PaperIsland,
  PaperIslandDirective,
  PaperIslandScheme,
} from '../../../shared/email/paper-island';
import { TemplateDesignerData } from './open-template-designer';

/** The phone's screen, px — the phone frame's own default. */
const PHONE_WIDTH = 375;

/** The right column's panels. */
type AsideTab = 'envelope' | 'source';

/** Their tabs, top to bottom: an icon, and the word shown beside it while
    the pointer rests on the tabs. */
const ASIDE_TABS: readonly { id: AsideTab; icon: string; label: string }[] = [
  { id: 'envelope', icon: 'mail', label: 'designer.details' },
  { id: 'source', icon: 'code', label: 'designer.source' },
];

/** The same message, as far as a template keeps one: its rows, its body and
    its files. */
function sameMessage(a: Envelope, b: Envelope): boolean {
  return (
    a.html === b.html &&
    a.subject === b.subject &&
    a.previewText === b.previewText &&
    a.from.join() === b.from.join() &&
    a.to.join() === b.to.join() &&
    a.cc.join() === b.cc.join() &&
    a.bcc.join() === b.bcc.join() &&
    a.attachments.map((file) => file.key).join() === b.attachments.map((file) => file.key).join()
  );
}

/**
 * The template designer: a template opened over the whole screen
 * (`openTemplateDesigner`, a dialog of its own chunk) to be shaped — the
 * zoomed compose window's document, made a design tool, Figma's way. A
 * desktop's alone: nothing here is laid out for a phone.
 *
 * - One paper, as the zoomed window is: bar, canvas, phone and details all
 *   on the message's paper, nothing of a desk under them.
 * - Three panes, an editor's (VS Code's): the phone's preview, the editor,
 *   the details — the sides dragged by their dividers and folded from the
 *   bar, the editor keeping its 720px whatever they ask.
 * - The canvas: the editor in the email's 720px column — or a wider
 *   email's own width, the canvas scrolling it both ways — its layout
 *   blocks taking their gestures (design, never write) and the formatting
 *   toolbar always there.
 * - On the right, the message's rows — From, To, Cc, Bcc, Subject,
 *   Preview — straight away, and its attachments under them, dropped or
 *   picked on one zone. With the HTML source beside them, the two are
 *   tabs down the column's right edge — a browser's vertical tabs — one
 *   shown at a time; more panels join them there.
 * - The layout is the email's page (the library's `PageLayout`): none, or
 *   a centred column of a width on a page colour, the column's own colour
 *   over it — set only here, a step of the editor's, so undo takes it back.
 *   The page shows inside the email's own column (720px), round the
 *   layout's: the container is the bound, never the canvas.
 * - The phone: the message as the inbox shows it received on a 375px phone
 *   — the very `mail-view` the reader uses, which lays itself out by the
 *   room the phone gives it — live as typing settles, on the light paper
 *   and the dark at once: a divider down the screen parts the two, and
 *   slides to show all of either. On when asked for, in the pane on the
 *   left.
 * - Its HTML: the bar's </> puts the source in the right column, a tab
 *   beside the details — phone, editor, HTML side by side — where the desk holds
 *   all three at their least; narrower, in the editor's place (code view,
 *   the compose page's same pane). The window resizing moves it between
 *   the two.
 * - No Send: a template is not sent. Save stores it (Ctrl/⌘+S too);
 *   Revert puts it back as last saved.
 * - While anything is unsaved, Escape does not close the dialog — a design
 *   is too much work to lose to a stray key. The close button always does:
 *   pressing it is a decision.
 *
 * It is a sheet (`MessageSheet`) of its own beside the desktop's and the
 * phone's — the message logic, the rows and the editor shared, the layout
 * its own — and a paper island (paper-island.ts) for everything in it.
 */
@Component({
  selector: 'template-designer',
  imports: [
    TranslatePipe,
    FormField,
    FieldKeys,
    MatButton,
    MatIconButton,
    MatIcon,
    MatProgressSpinner,
    MatTooltip,
    GlassGroup,
    PaperToggle,
    AngularFileDrop,
    DropHint,
    AttachmentChips,
    AttachmentChip,
    AttachmentChipIcon,
    EmailCompose,
    HtmlEmailCompose,
    SourceSearch,
    EnvelopeRows,
    MessageSettingsButton,
    MarqueeStart,
    ScrollOwner,
    SplitHandle,
    PaperIslandDirective,
    PaperIslandScheme,
    OverlayModule,
    MailView,
    Badge,
    PageHeader,
    PhoneFrame,
    ColorPalette,
  ],
  providers: [
    { provide: MessageSheet, useExisting: TemplateDesigner },
    // One inline image registry per composer: this template's.
    InlineImages,
    { provide: PaperIsland, useExisting: TemplateDesigner },
  ],
  templateUrl: './template-designer.html',
  styleUrl: './template-designer.scss',
  // An .eml dropped anywhere on the designer, or pasted where no field takes
  // the paste (the file, or its raw text), opens as the design.
  hostDirectives: [{ directive: MessageImport, outputs: ['messageImport'] }],
  host: {
    '(messageImport)': 'studyEmail($event)',
    '[attr.data-paper-scheme]': 'scheme()',
    '[attr.data-preview]': "phoneOpen() ? (previewDocked() ? 'docked' : 'over') : null",
    '[attr.data-details]': "asideShown() ? (detailsDocked() ? 'docked' : 'over') : 'folded'",
    '[attr.data-tabbed]': 'tabbed() || null',
    '[attr.data-source]': "sourceDocked() ? 'docked' : null",
    '[attr.data-view]': 'editorView()',
    '(keydown)': 'shortcut($event)',
    '(window:resize)': 'measureDesk()',
  },
})
export class TemplateDesigner extends MessageSheet implements PaperIsland {
  readonly #ref = inject<MatDialogRef<TemplateDesigner>>(MatDialogRef);
  readonly #templates = inject(Templates);
  readonly #snack = inject(MatSnackBar);

  /** Whether the editor's formatting toolbar shows — the bar's switch, the
      writer bar's preference (`formattingToolbar`), shared. */
  protected readonly formattingOpen = inject(Preferences).formattingToolbar;

  /** The island's element (`PaperIsland`): the whole designer — the
      editor's marquee draws across it. */
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly marquee = new IslandMarquee();
  /** The island's paper: the message's Appearance (the settings'). */
  readonly scheme = computed(() => this.editorScheme());

  protected readonly barAtTop = signal(true).asReadonly();

  /** The template as last stored — what Revert goes back to, and what Save
      writes over. */
  readonly #template = signal(inject<TemplateDesignerData>(MAT_DIALOG_DATA).template);
  protected readonly name = computed(() => this.#template().name);
  /** Its category tag: its dialect, or its set's name (MJML). */
  protected readonly tag = computed(() => this.#template().tag);

  /** A template was stored — the gallery redraws its card. */
  readonly saved = output<EmailTemplate>();

  /** The message as it was last saved: first, the template as it opened,
      round the body as the editor first published it (its `baseline` — the
      schema's canonical form; the template's HTML as stored may be spelled
      otherwise); then each save. Null until the editor has said what the
      body is, so nothing reads as a change before. */
  readonly #clean = linkedSignal<string | null, Envelope | null>({
    source: () => this.emailPane().baseline(),
    computation: (baseline, previous) =>
      previous?.value ??
      (baseline === null ? null : { ...untracked(this.message), html: baseline }),
  });

  /** Anything changed since the last save. */
  readonly dirty = computed(() => {
    const clean = this.#clean();
    return clean !== null && !sameMessage(this.message(), clean);
  });

  /** Saves on their way — the rows' own and Save's — and the chain they
      run on, one after another: two writes of one template never race. */
  readonly #pending = signal(0);
  #queue: Promise<unknown> = Promise.resolve();
  protected readonly saving = computed(() => this.#pending() > 0);

  /** The details open on the right — or folded to their one line by the
      bar's toggle, or by that line's press back open. */
  protected readonly detailsOpen = signal(true);

  /** The phone on the left of the canvas. */
  protected readonly phoneOpen = signal(false);

  /** The desk under the bar: the three panes' room. */
  private readonly desk = viewChild.required('desk', { read: ElementRef<HTMLElement> });
  /** Its width, px — the screen's until it is first measured (the dialog
      fills it), so the panes open docked where they will stay. */
  readonly #deskWidth = signal(inject(DOCUMENT).defaultView?.innerWidth ?? 0);

  /** The panes' widths as dragged — kept for the next template. The right
      column keeps two: the details' alone, and with the source under them
      (code reads wide). */
  protected readonly previewWidth = inject(Preferences).designerPreviewWidth;
  protected readonly detailsWidth = inject(Preferences).designerDetailsWidth;
  protected readonly sourceWidth = inject(Preferences).designerSourceWidth;
  protected readonly previewMin = DESIGNER_PREVIEW_MIN;
  protected readonly previewMax = DESIGNER_PREVIEW_MAX;
  protected readonly detailsMin = DESIGNER_DETAILS_MIN;
  protected readonly detailsMax = DESIGNER_DETAILS_MAX;
  protected readonly sourceMin = DESIGNER_SOURCE_MIN;
  protected readonly sourceMax = DESIGNER_SOURCE_MAX;

  /** The desk's room once the phone is open, px: what the editor and the
      right column share. */
  readonly #deskBesidePhone = computed(
    () => this.#deskWidth() - (this.phoneOpen() ? DESIGNER_PREVIEW_MIN : 0),
  );

  /** Whether the desk holds the HTML source beside the editor, both at
      their least, and the phone open at its least — short of that, the
      source takes the editor's place and the phone keeps its pane. */
  readonly #sourceFits = computed(
    () => this.#deskBesidePhone() >= DESIGNER_EDITOR_MIN + DESIGNER_SOURCE_MIN,
  );

  /** The HTML source in the right column, under the details (`detached`):
      asked for, where it fits. */
  protected readonly sourceDocked = computed(() => this.sourceView() === 'detached');

  /** The right column is there: the details open, or the source in it. */
  protected readonly asideShown = computed(() => this.detailsOpen() || this.sourceDocked());

  /** The right column's least and width, px: the source's while it is in
      it, the details' otherwise. */
  readonly #asideMin = computed(() =>
    this.sourceDocked() ? DESIGNER_SOURCE_MIN : DESIGNER_DETAILS_MIN,
  );
  protected readonly asideWidth = computed(() =>
    this.sourceDocked() ? this.sourceWidth() : this.detailsWidth(),
  );

  /** The right column as a pane of its own, pushing the editor aside: the
      source's always (it docks only where it fits); the details' alone on
      a wide desk (`DESIGNER_DETAILS_PUSH_MIN`), the phone's pane aside.
      Narrower, the details float over the editor's end — a Mac's sidebar —
      and the email keeps the desk's width. */
  protected readonly detailsDocked = computed(
    () =>
      this.sourceDocked() ||
      (this.detailsOpen() &&
        this.#deskBesidePhone() >=
          Math.max(DESIGNER_DETAILS_PUSH_MIN, DESIGNER_EDITOR_MIN + DESIGNER_DETAILS_MIN)),
  );

  /** The preview as a pane of its own: open, where the desk holds it at
      its least beside the editor's and the docked right column's — it
      gives way first. Narrower, it floats over the editor's start. */
  protected readonly previewDocked = computed(
    () =>
      this.phoneOpen() &&
      this.#deskWidth() >=
        DESIGNER_EDITOR_MIN + DESIGNER_PREVIEW_MIN + (this.detailsDocked() ? this.#asideMin() : 0),
  );

  /** What each divider leaves the rest, px: the editor's least, and the
      other pane — the right column as wide as it stands (the preview only
      takes what it leaves), the preview at its least (the right column may
      push it there). The desk's tracks say the same (the stylesheet). */
  protected readonly previewKeep = computed(() => {
    if (!this.detailsDocked()) return DESIGNER_EDITOR_MIN;
    const least = this.previewDocked() ? DESIGNER_PREVIEW_MIN : 0;
    const aside = Math.min(this.asideWidth(), this.#deskWidth() - DESIGNER_EDITOR_MIN - least);
    return DESIGNER_EDITOR_MIN + aside;
  });
  protected readonly detailsKeep = computed(
    () => DESIGNER_EDITOR_MIN + (this.previewDocked() ? DESIGNER_PREVIEW_MIN : 0),
  );

  /** The right column's panels, as its tabs list them: the details while
      they are open, the source while it is beside the editor. */
  protected readonly asideTabs = computed(() =>
    ASIDE_TABS.filter((tab) => (tab.id === 'envelope' ? this.detailsOpen() : this.sourceDocked())),
  );

  /** More than one panel: the tabs down the column's edge, one panel shown. */
  protected readonly tabbed = computed(() => this.asideTabs().length > 1);

  /** The tab picked — the panel that just came in, as it comes in (the
      source as </> is pressed, the details as they open); the one left
      when the other goes. */
  protected readonly asideTab = linkedSignal<{ envelope: boolean; source: boolean }, AsideTab>({
    source: () => ({ envelope: this.detailsOpen(), source: this.sourceDocked() }),
    computation: (now, previous) => {
      if (now.source && !previous?.source.source) return 'source';
      if (now.envelope && !previous?.source.envelope) return 'envelope';
      if (!now.source) return 'envelope';
      if (!now.envelope) return 'source';
      return previous?.value ?? 'envelope';
    },
  });

  /** The panel the column shows: the tab picked, or the one there is. */
  protected readonly shownPanel = computed<AsideTab | null>(() => {
    const tabs = this.asideTabs();
    if (tabs.length > 1) return this.asideTab();
    return tabs[0]?.id ?? null;
  });

  /** The source in sight — in the editor's place, or its panel shown. */
  protected readonly sourceShown = computed(
    () => this.editorView() === 'html' || this.shownPanel() === 'source',
  );

  /** The tabs' keys, a vertical tab list's: up and down (wrapping), Home
      and End — the selection follows, the focus with it. */
  protected tabKey(event: KeyboardEvent): void {
    const tabs = this.asideTabs();
    const at = tabs.findIndex((tab) => tab.id === this.asideTab());
    const next =
      event.key === 'ArrowDown'
        ? (at + 1) % tabs.length
        : event.key === 'ArrowUp'
          ? (at - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const id = tabs[next].id;
    this.asideTab.set(id);
    this.element.querySelector<HTMLElement>(`#designer-tab-${id}`)?.focus();
  }

  /** The phone's screen, px: the narrowest a message is still read on. */
  protected readonly phoneWidth = PHONE_WIDTH;
  /** The papers the phone reads the mail on, left to right of its divider. */
  protected readonly papers = ['light', 'dark'] as const;
  /** Where the divider stands, px from the screen's left: the light paper
      to the left of it, the dark to the right — half and half to start. */
  protected readonly phoneSplit = signal(PHONE_WIDTH / 2);

  /** The layout's panel, under its button in the bar. */
  protected readonly layoutOpen = signal(false);
  /** Under the button, its end on the button's end; above it when the
      screen's foot is too near. */
  protected readonly layoutPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    {
      originX: 'end',
      originY: 'top',
      overlayX: 'end',
      overlayY: 'bottom',
      offsetY: -8,
      panelClass: 'motion-above',
    },
  ];

  /** Escape puts the panel away, the focus back on its button. (A press
      outside closes it too — never one on its button, which toggles it: the
      CDK leaves the origin out of `overlayOutsideClick`.) */
  protected layoutKey(event: KeyboardEvent, origin: CdkOverlayOrigin): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.closeLayout(origin);
  }

  /** The panel put away, the focus back on its button — Escape, on the
      panel or in one of its fields. */
  protected closeLayout(origin: CdkOverlayOrigin): void {
    this.layoutOpen.set(false);
    (origin.elementRef.nativeElement as HTMLElement).focus();
  }

  /** The page layouts, as the Layout tab's swatches offer them. */
  protected readonly layoutKinds = ['none', 'centered', 'table', 'stylesheet'] as const;

  /** A Stylesheet page's own fields, in the panel's order. */
  protected readonly sheetFields = ['inset', 'phoneInset', 'phoneSpacing'] as const;

  /** The email's page layout, as its editor holds it (`pageLayoutModel`):
      every field a step of the editor's, so undo takes it back — the
      kinds at once, a number once its field is done with (left, or Enter,
      or a step of its arrows), snapped to its grid by the editor. */
  protected readonly pageLayout = form(
    pageLayoutModel(() => this.emailPane().editor()),
    (page) => {
      min(page.width, PAGE_WIDTH_MIN);
      max(page.width, PAGE_WIDTH_MAX);
      min(page.spacing, 0);
      max(page.spacing, PAGE_SPACING_MAX);
      min(page.rowPadding, 0);
      max(page.rowPadding, PAGE_ROW_PADDING_MAX);
      for (const field of [page.inset, page.phoneInset]) {
        min(field, 0);
        max(field, PAGE_INSET_MAX);
      }
      min(page.phoneSpacing, 0);
      max(page.phoneSpacing, PAGE_SPACING_MAX);
      for (const field of [
        page.width,
        page.spacing,
        page.rowPadding,
        page.inset,
        page.phoneInset,
        page.phoneSpacing,
      ])
        debounce(field, 'blur');
    },
  );
  /** The page's fills: the palette's, then the user's custom swatches. */
  readonly #swatches = injectSwatches();
  protected readonly backgroundPalette = computed(() => this.#swatches().background);
  readonly #palette = injectPalette();
  readonly #customSwatches = inject(EMAIL_CUSTOM_SWATCHES);

  /** The phone's email: the body as typing settles — a frame redrawn on
      every key would flicker. */
  protected readonly phoneHtml = atRest(() => this.html());

  /** The phone's mail, as the inbox would show it received (`mail-view`):
      the sender split into name and address as the reader splits it, the
      recipients written out, the subject or what an unnamed one is called,
      and the moment it opened as its date. */
  protected readonly received = computed(() => {
    const { from, to, cc, subject } = this.message();
    const sender = from[0] ?? '';
    const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(sender);
    return {
      subject: subject.trim() || this.i18n.t('designer.noSubject'),
      name: match?.[1] || match?.[2] || sender,
      address: match?.[1] ? match[2] : null,
      to: to.join(', '),
      cc: cc.length ? cc.join(', ') : null,
      date: new Intl.DateTimeFormat(this.i18n.lang(), { timeStyle: 'short' }).format(this.#opened),
    };
  });

  readonly #opened = new Date();

  constructor() {
    super();
    const template = this.#template();
    this.message.set(this.#envelopeOf(template));
    // A design desk: the layout blocks take their gestures.
    this.layoutInteractive.set(true);

    // Nothing unsaved is lost to a stray Escape (the dialog fills the
    // screen: there is no backdrop to press beside it).
    effect(() => (this.#ref.disableClose = this.dirty()));

    // The source shown stands where the desk has room for it: beside the
    // editor, or in its place — the window resizing moves it across.
    effect(() => {
      const view = this.sourceView();
      if (view === 'hidden') return;
      const place = this.#sourceFits() ? 'detached' : 'code';
      if (view !== place) untracked(() => this.sourceView.set(place));
    });

    // The designer is the screen: the back button (the gesture, the
    // browser's own) closes it instead of leaving the gallery under it, as
    // it closes a full-screen compose window. Closed any other way, the
    // guard's entry goes with it.
    const held = inject(BackButton).guard({ dismiss: () => this.close() });
    inject(DestroyRef).onDestroy(held.release);

    afterNextRender(() => this.measureDesk());
  }

  /** The desk's width, read as it is first drawn and as the window
      resizes — it fills the window, nothing else moves it: which panes it
      holds. */
  protected measureDesk(): void {
    this.#deskWidth.set(this.desk().nativeElement.clientWidth);
  }

  /** A divider grabbed: the source keeps the width it has until the drag
      ends (the desk's `data-resizing`) — re-wrapping a long template on
      every frame of a drag is what made it lag; it wraps once, on release. */
  protected holdSource(): void {
    const width = this.sourceEl().nativeElement.getBoundingClientRect().width;
    this.desk().nativeElement.style.setProperty('--designer-source-held', `${width}px`);
  }

  /** The source pane as a developer's editor — the designer is where HTML
      is written by hand: line numbers and the caret's line, folding, the
      matching tag, VS Code's line keys (and the search bar, projected).
      Opt-in: the composer's source pane stays lean without them. */
  protected readonly sourceTools = [
    createSourceGutter(),
    createSourceFolding(),
    createTagMatching(),
    createSourceKeys(),
  ];

  /** The HTML source, and its node for the code-view portal. */
  protected readonly sourcePane = viewChild.required(HtmlEmailCompose);
  private readonly sourceEl = viewChild.required('sourceEl', { read: ElementRef });

  /** In code view the source's own node moves into the editor's place. */
  protected readonly sourcePortal = computed(() =>
    this.editorView() === 'html' ? new DomPortal(this.sourceEl()) : null,
  );

  /** A design needs its HTML: the designer holds a source pane of its own. */
  protected override sourceOffered(): boolean {
    return true;
  }

  /** The View's HTML: the source beside the editor where the desk holds
      both, in its place otherwise. */
  override onEditorView(view: EditorView): void {
    if (view === 'html' && this.#sourceFits()) {
      releaseEditingSurface();
      this.sourceView.set('detached');
      return;
    }
    super.onEditorView(view);
  }

  /** The bar's </>: the HTML shown — beside the editor or in its place —
      or put away. */
  protected toggleSource(): void {
    if (this.sourceView() === 'hidden') {
      this.onEditorView('html');
      return;
    }
    releaseEditingSurface();
    this.sourceView.set('hidden');
  }

  /** Where the designer starts: the text — the canvas is what it is for,
      never To in the panel. */
  override focus(): void {
    this.emailPane().takeFocus();
  }

  /** No recipient needed: whoever writes on the template addresses it. */
  protected override recipientsRequired(): boolean {
    return false;
  }

  /** The message a template opens as: its saved rows, or a new message's,
      round its body. */
  #envelopeOf(template: EmailTemplate): Envelope {
    return { ...BLANK, ...template.envelope, html: template.html };
  }

  /** Runs `write` after every save before it, counted while it is on its
      way — what the Save button's spinner shows. */
  #enqueue(write: () => Promise<void>): Promise<void> {
    this.#pending.update((count) => count + 1);
    const run = this.#queue.then(write).finally(() => this.#pending.update((count) => count - 1));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /** Stores the template as it stands. */
  protected async save(): Promise<void> {
    if (this.saving()) return;
    const message = this.message();
    const { from, to, cc, bcc, subject, previewText, attachments } = message;
    await this.#enqueue(async () => {
      try {
        const stored = await this.#templates.save({
          ...this.#template(),
          html: message.html,
          envelope: { from, to, cc, bcc, subject, previewText, attachments },
        });
        this.#template.set(stored);
        this.#clean.set(message);
        this.saved.emit(stored);
        this.#snack.open(this.i18n.t('designer.saved'), undefined, { duration: 3000 });
      } catch {
        this.#snack.open(this.i18n.t('designer.saveFailed'), undefined, { duration: 6000 });
      }
    });
  }

  /** An address row the user is done with is stored at once — that row
      alone, over the template as last stored: the body and the other rows
      wait for Save. A row the form finds wrong waits too. Stored, the row
      is clean (Revert leaves it); failed, it stays unsaved, and Save takes
      it with the rest. */
  protected saveRow({ row, value }: { row: AddressRow; value: string[] }): void {
    if (this.envelope[row]().invalid()) return;
    void this.#enqueue(async () => {
      const template = this.#template();
      const { from, to, cc, bcc, subject, previewText, attachments } = {
        ...BLANK,
        ...template.envelope,
      };
      const envelope = { from, to, cc, bcc, subject, previewText, attachments, [row]: value };
      try {
        const stored = await this.#templates.save({ ...template, envelope });
        this.#template.set(stored);
        this.#clean.update((clean) => clean && { ...clean, [row]: value });
        this.saved.emit(stored);
      } catch {
        this.#snack.open(this.i18n.t('designer.saveFailed'), undefined, { duration: 6000 });
      }
    });
  }

  /** Back to the template as last saved — no confirmation: it is one
      press, and what it throws away is what the press says. */
  protected revert(): void {
    const clean = this.#clean();
    if (!clean) return;
    // Into the editor even while it is typed in, as a step its undo takes
    // back; the rest of the message follows through the form.
    this.emailPane().replace(clean.html);
    for (const file of this.message().attachments) {
      if (!clean.attachments.some((kept) => kept.key === file.key)) this.uploads.cancel(file.key);
    }
    this.message.set(clean);
  }

  /** A colour picked for the page, or for its column. */
  protected setPageColor(background: string | null): void {
    this.pageLayout.background().value.set(background);
    if (background) this.#noteCustom(background);
  }

  protected setColumnColor(columnBackground: string | null): void {
    this.pageLayout.columnBackground().value.set(columnBackground);
    if (columnBackground) this.#noteCustom(columnBackground);
  }

  /** A page colour none of the palette's: the user keeps it as a swatch. */
  #noteCustom(color: string): void {
    if (isPaletteColor(this.#palette, color, 'background')) return;
    rememberSwatch(this.#customSwatches, color, 'background');
  }

  /** An email being read into the design. */
  /** The designer's import: a file hanging over it lights the button and
      shows the drop hint. */
  protected readonly import = inject(MessageImport);

  protected readonly studying = signal(false);

  /** An email to study, brought in — picked, dropped or pasted: made
      this design, its body, subject and files (one undo step;
      Revert still goes back to the template as saved). Says what came in. */
  protected async studyEmail(file: File): Promise<void> {
    if (this.studying()) return;
    this.studying.set(true);
    try {
      this.#snack.open(await this.importEml(file, 'design'), undefined, { duration: 4000 });
    } finally {
      this.studying.set(false);
    }
  }

  /** The button's picker: the file chosen, then the picker emptied so the
      same file can be picked again. */
  protected studyPicked(picker: HTMLInputElement): void {
    const file = picker.files?.[0];
    picker.value = '';
    if (file) void this.studyEmail(file);
  }

  /** Closes the designer — the close button's, unsaved changes and all:
      a press on it is a decision, not a slip. */
  protected close(): void {
    this.#ref.close();
  }

  /** Ctrl/⌘+S saves, as in every design tool — never the page. */
  protected shortcut(event: KeyboardEvent): void {
    if (event.key.toLowerCase() !== 's' || !(event.ctrlKey || event.metaKey) || event.altKey)
      return;
    event.preventDefault();
    if (this.dirty()) void this.save();
  }
}
