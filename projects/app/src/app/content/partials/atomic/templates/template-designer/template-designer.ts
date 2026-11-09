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
import { NgTemplateOutlet } from '@angular/common';

// Angular Aria
import { MenuTrigger } from '@angular/aria/menu';

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
  embeddedImages,
  withoutEmbeddedImages,
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
  DESIGNER_EDITOR_MIN,
  DESIGNER_PREVIEW_MAX,
  DESIGNER_PREVIEW_MIN,
  DESIGNER_SOURCE_MAX,
  DESIGNER_SOURCE_MIN,
  Preferences,
  type SourceScheme,
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
import {
  EmailCompose,
  type EditorColorScheme,
} from '../../../shared/email/email-compose/email-compose';
import { ColorPalette } from '../../../shared/email/email-compose/formatting-toolbar/color-palette/color-palette';
import { HtmlEmailCompose } from '../../../shared/email/html-email-compose/html-email-compose';
import { SourceSearch } from '../../../shared/email/source-search/source-search';
import {
  AddressRow,
  EnvelopeRows,
} from '../../../shared/email/message-form/envelope-rows/envelope-rows';
import { ToolbarMenu, type ToolbarMenuItem } from '../../../common/toolbar-menu/toolbar-menu';
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

/** What the bar's ⋮ does to the design as a whole. */
type MoreAction = 'study';

/** The phone's screen, px — the phone frame's own default. */
const PHONE_WIDTH = 375;

/** A tab rail's width, px — the stylesheet's `$tabs-rail`: a tab's 28px
    6px in from the desk's edge on either side, under the bar's close
    button. */
const TABS_RAIL = 40;

/** A tab down a rail: an icon, and the word shown beside it while the
    pointer rests on the tabs. */
interface DeskTab<T extends string> {
  readonly id: T;
  readonly icon: string;
  readonly label: string;
  /** Pressed to no effect, for now. */
  readonly disabled?: boolean;
}

/** The left column's panels. */
type AsideTab = 'envelope' | 'source';

/** Their tabs, top to bottom. */
const ASIDE_TABS: readonly DeskTab<AsideTab>[] = [
  { id: 'envelope', icon: 'mail', label: 'designer.details' },
  { id: 'source', icon: 'code', label: 'designer.source' },
];

/** The right side's views, while the desk is too narrow for both: the
    editor, or the phone in its place. */
type StageTab = 'editor' | 'phone';

const STAGE_TABS: readonly DeskTab<StageTab>[] = [
  { id: 'editor', icon: 'edit', label: 'designer.design' },
  { id: 'phone', icon: 'smartphone', label: 'designer.phone' },
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
 * - Three panes, an editor's (VS Code's): the details on the left, then the
 *   editor and the phone's preview — the sides dragged by their dividers
 *   and folded from the bar, the editor keeping a phone's 375px whatever
 *   they ask. Too narrow a desk for the phone beside the editor, the two are
 *   tabs down the right edge, one shown at a time in the editor's place.
 * - The canvas: the editor in the email's 720px column — narrower with
 *   the pane, down to a phone's 375px — or a wider
 *   email's own width, the canvas scrolling it both ways — its layout
 *   blocks taking their gestures (design, never write) and the formatting
 *   toolbar always there.
 * - On the left, the message's rows — From, To, Cc, Bcc, Subject,
 *   Preview — straight away, and its attachments under them, dropped or
 *   picked on one zone. With the HTML source beside them, the two are
 *   tabs down the column's left edge — a browser's vertical tabs — one
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
 *   right — or a tab beside the editor's, where the desk is too narrow.
 * - Its HTML: the rail's source tab puts the source in the left column in
 *   the details' place — HTML, editor, phone side by side — where the desk
 *   holds the source and the editor at their least; narrower, in the
 *   editor's place (code view, the compose page's same pane). The window
 *   resizing moves it between the two; the details' tab puts it away. Made
 *   the first time it is asked for, never before.
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
    NgTemplateOutlet,
    MenuTrigger,
    ToolbarMenu,
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
  styleUrls: ['./template-designer.scss', './template-designer-layout.scss'],
  // An .eml dropped anywhere on the designer, or pasted where no field takes
  // the paste (the file, or its raw text), opens as the design.
  hostDirectives: [{ directive: MessageImport, outputs: ['messageImport'] }],
  host: {
    '(messageImport)': 'studyEmail($event)',
    '[attr.data-paper-scheme]': 'scheme()',
    '[attr.data-preview]': "phoneOpen() ? (previewDocked() ? 'docked' : 'tabbed') : null",
    '[attr.data-stage]': 'previewTabbed() ? stageTab() : null',
    '[attr.data-details]': "asideShown() ? (detailsDocked() ? 'docked' : 'over') : 'folded'",
    '[attr.data-source]': "sourceDocked() ? 'docked' : null",
    '[attr.data-view]': 'editorView()',
    '(keydown)': 'shortcut($event)',
    '(window:resize)': 'measureDesk()',
  },
})
export class TemplateDesigner extends MessageSheet implements PaperIsland {
  readonly #ref = inject<MatDialogRef<TemplateDesigner>>(MatDialogRef);
  readonly #templates = inject(Templates);
  readonly #inlineImages = inject(Preferences).inlineImages;
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

  /** The bar is always over the desk (`MessageSheet`'s menus open under
      it). */
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

  /** The details open in the left column — or put away by the bar's
      panel toggle, the column folded to its rail. */
  protected readonly detailsOpen = signal(true);

  /** The phone on the right of the canvas. */
  protected readonly phoneOpen = signal(false);

  /** The desk under the bar: the three panes' room. */
  private readonly desk = viewChild.required('desk', { read: ElementRef<HTMLElement> });
  /** Its width, px — the screen's until it is first measured (the dialog
      fills it), so the panes open docked where they will stay. */
  readonly #deskWidth = signal(inject(DOCUMENT).defaultView?.innerWidth ?? 0);

  /** The panes' widths as dragged — kept for the next template. The left
      column keeps two: the details', and the source's in their place (code
      reads wide). */
  protected readonly previewWidth = inject(Preferences).designerPreviewWidth;
  protected readonly detailsWidth = inject(Preferences).designerDetailsWidth;
  protected readonly sourceWidth = inject(Preferences).designerSourceWidth;
  protected readonly previewMin = DESIGNER_PREVIEW_MIN;
  protected readonly previewMax = DESIGNER_PREVIEW_MAX;
  protected readonly detailsMin = DESIGNER_DETAILS_MIN;
  protected readonly detailsMax = DESIGNER_DETAILS_MAX;
  protected readonly sourceMin = DESIGNER_SOURCE_MIN;
  protected readonly sourceMax = DESIGNER_SOURCE_MAX;

  /** The desk's room for the left column and the editor, px: the left
      column's tabs keep their rail always; the phone, at the least, takes
      its tabs' rail — it gives way to a tab before it squeezes either. */
  readonly #deskBesidePhone = computed(
    () => this.#deskWidth() - TABS_RAIL - (this.phoneOpen() ? TABS_RAIL : 0),
  );

  /** Whether the desk holds the HTML source beside the editor, both at
      their least — short of that, the source takes the editor's place. */
  readonly #sourceFits = computed(
    () => this.#deskBesidePhone() >= DESIGNER_EDITOR_MIN + DESIGNER_SOURCE_MIN,
  );

  /** The HTML source in the left column, in the details' place
      (`detached`): asked for, where it fits. */
  protected readonly sourceDocked = computed(() => this.sourceView() === 'detached');

  /** The left column's panel is there: the details open, or the source in
      it. Its tabs' rail is there either way. */
  protected readonly asideShown = computed(() => this.detailsOpen() || this.sourceDocked());

  /** The left column's least and width, px: the source's while it is in
      it, the details' otherwise. */
  readonly #asideMin = computed(() =>
    this.sourceDocked() ? DESIGNER_SOURCE_MIN : DESIGNER_DETAILS_MIN,
  );
  protected readonly asideWidth = computed(() =>
    this.sourceDocked() ? this.sourceWidth() : this.detailsWidth(),
  );

  /** The left column as a pane of its own, pushing the editor aside —
      room kept for it wherever the desk holds it beside the editor's
      least: the source's always (it docks only where it fits), the
      details' too. Narrower, the details float over the editor's start —
      a Mac's sidebar — and the email keeps the desk's width. */
  protected readonly detailsDocked = computed(
    () =>
      this.sourceDocked() ||
      (this.detailsOpen() && this.#deskBesidePhone() >= DESIGNER_EDITOR_MIN + DESIGNER_DETAILS_MIN),
  );

  /** The preview as a pane of its own: open, where the desk holds it at
      its least beside the editor's and the docked left column's — it
      gives way first. Narrower, it is a tab beside the editor's, in its
      place (`previewTabbed`). */
  protected readonly previewDocked = computed(
    () =>
      this.phoneOpen() &&
      this.#deskWidth() - TABS_RAIL >=
        DESIGNER_EDITOR_MIN + DESIGNER_PREVIEW_MIN + (this.detailsDocked() ? this.#asideMin() : 0),
  );

  /** The phone open with no room of its own: the editor and the phone are
      tabs down the desk's right edge, one in the editor's place. */
  protected readonly previewTabbed = computed(() => this.phoneOpen() && !this.previewDocked());

  /** What each divider leaves the rest, px: the editor's least and the
      left column's rail, and the other pane — the left column as wide as
      it stands (the preview only takes what it leaves), the preview at its
      least (the left column may push it there), or the phone's rail. The
      desk's tracks say the same (the stylesheet). */
  protected readonly previewKeep = computed(() => {
    if (!this.detailsDocked()) return DESIGNER_EDITOR_MIN + TABS_RAIL;
    const least = this.previewDocked() ? DESIGNER_PREVIEW_MIN : 0;
    const room = this.#deskWidth() - TABS_RAIL - DESIGNER_EDITOR_MIN - least;
    return DESIGNER_EDITOR_MIN + TABS_RAIL + Math.min(this.asideWidth(), room);
  });
  protected readonly detailsKeep = computed(
    () =>
      DESIGNER_EDITOR_MIN +
      TABS_RAIL +
      (this.previewDocked() ? DESIGNER_PREVIEW_MIN : this.previewTabbed() ? TABS_RAIL : 0),
  );

  /** The left column's tabs: always there, on a rail of their own — the
      source's off while the message has no HTML (plain text). */
  protected readonly asideTabs = computed<readonly DeskTab<AsideTab>[]>(() =>
    ASIDE_TABS.map((tab) =>
      tab.id === 'source' ? { ...tab, disabled: !this.viewOffered() } : tab,
    ),
  );

  /** The right side's tabs, while the phone is one. */
  protected readonly stageTabs = STAGE_TABS;

  /** The right side's tab picked: the editor whenever the phone becomes a
      tab or stops being one — the desk narrowing under a docked phone
      keeps the work in sight — unless the bar's press opened the phone
      onto its tab (`togglePhone`): that press is to see it. */
  protected readonly stageTab = linkedSignal<boolean, StageTab>({
    source: this.previewTabbed,
    computation: () => 'editor',
  });

  /** The bar's phone: open — onto its tab, where it has no pane — or put
      away. */
  protected togglePhone(): void {
    this.phoneOpen.update((open) => !open);
    if (this.previewTabbed()) this.stageTab.set('phone');
  }

  /** A right-side tab pressed. */
  protected readonly pickStage = (tab: StageTab): void => this.stageTab.set(tab);

  /** The panel the column shows: the source while it stands beside the
      editor, the details otherwise — none while both are put away, the
      rail alone. */
  protected readonly shownPanel = computed<AsideTab | null>(() =>
    this.sourceDocked() ? 'source' : this.detailsOpen() ? 'envelope' : null,
  );

  /** The left tab lit: the source's while the HTML is out — beside the
      editor or in its place — the details' while they are shown. */
  protected readonly asideSelected = computed<AsideTab | null>(() =>
    this.sourceView() === 'hidden' ? this.shownPanel() : 'source',
  );

  /** A left tab pressed — the rail is the HTML's switch: the source's shows
      it (beside the editor, or in its place where the desk is too narrow);
      the details' puts it away and shows the rows. Never folds the column:
      the rail is for moving between them. */
  protected readonly pickAside = (tab: AsideTab): void => {
    if (tab === 'source') {
      if (this.sourceView() === 'hidden') this.onEditorView('html');
      return;
    }
    this.detailsOpen.set(true);
    this.#hideSource();
  };

  /** The bar's panel toggle: the left column folded to its rail — whatever
      it holds — or opened on the details. */
  protected toggleAside(): void {
    if (!this.asideShown()) {
      this.detailsOpen.set(true);
      return;
    }
    this.detailsOpen.set(false);
    if (this.sourceDocked()) this.#hideSource();
  }

  /** The HTML put away, the editor back where it stood in for it. */
  #hideSource(): void {
    if (this.sourceView() === 'hidden') return;
    releaseEditingSurface();
    this.sourceView.set('hidden');
  }

  /** The source in sight — in the editor's place, or its panel shown. */
  protected readonly sourceShown = computed(
    () => this.editorView() === 'html' || this.shownPanel() === 'source',
  );

  /** A rail's keys, a vertical tab list's: up and down (wrapping, past an
      off tab), Home and End — the selection follows, the focus with it. */
  protected tabKey<T extends string>(
    event: KeyboardEvent,
    all: readonly DeskTab<T>[],
    picked: T | null,
    pick: (tab: T) => void,
  ): void {
    const tabs = all.filter((tab) => !tab.disabled);
    const at = tabs.findIndex((tab) => tab.id === picked);
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
    pick(id);
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
    const source = this.sourceEl();
    if (!source) return;
    const width = source.nativeElement.getBoundingClientRect().width;
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

  /** The HTML source made the first time it is asked for, and kept from
      then on — its undo history and folds carry across. Until then there
      is no editor to mount, and nothing re-formats and re-lints the whole
      email each time typing rests for a pane nobody has opened. */
  protected readonly sourceMade = linkedSignal<boolean, boolean>({
    source: () => this.sourceView() !== 'hidden',
    computation: (asked, previous) => asked || (previous?.value ?? false),
  });

  /** The HTML source, and its node for the code-view portal — none until
      it is made. */
  protected readonly sourcePane = viewChild(HtmlEmailCompose);
  private readonly sourceEl = viewChild('sourceEl', { read: ElementRef });

  /** In code view the source's own node moves into the editor's place. */
  protected readonly sourcePortal = computed(() => {
    const source = this.sourceEl();
    return this.editorView() === 'html' && source ? new DomPortal(source) : null;
  });

  /** The HTML source's paper as picked — its corner toggle, its hover
      menu: light, dark, or the designer's (the email's) own. */
  protected readonly sourceSchemePick = inject(Preferences).designerSourceScheme;

  /** The HTML source's paper, resolved: a paper island of its own. */
  protected readonly sourceScheme = computed<EditorColorScheme>(() => {
    const pick = this.sourceSchemePick();
    return pick === 'designer' ? this.scheme() : pick;
  });

  /** The source's papers, its hover menu's rows. */
  protected readonly sourceSchemes: readonly { id: SourceScheme; label: string }[] = [
    { id: 'designer', label: 'designer.sourceScheme.designer' },
    { id: 'light', label: 'designer.sourceScheme.light' },
    { id: 'dark', label: 'designer.sourceScheme.dark' },
  ];

  /** The toggle's press: the source's other paper, kept as its own pick. */
  protected flipSourceScheme(): void {
    this.sourceSchemePick.set(this.sourceScheme() === 'dark' ? 'light' : 'dark');
  }

  /** The source's paper menu put away — after a pick, or Escape — until
      the pointer and focus have both left it: else the hand still on it
      would hold it open. */
  protected readonly schemeShut = signal(false);

  /** The toggle, for the focus a pick hands back. */
  private readonly schemeToggle = viewChild('schemeToggle', { read: ElementRef<HTMLElement> });

  /** A row of the menu picked: that paper, the menu put away, focus back
      on the toggle (no ring for the pointer's pick). */
  protected pickSourceScheme(pick: SourceScheme): void {
    this.sourceSchemePick.set(pick);
    this.schemeShut.set(true);
    this.schemeToggle()?.nativeElement.focus();
  }

  /** Focus leaving the toggle and its menu: open again at the next hover. */
  protected schemeLeft(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as Node).contains(next)) this.schemeShut.set(false);
  }

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

  /** The body as it is stored. Inline images off (Settings › General):
      no embedded one is — it stays in the editor, greyed, and is stored as
      the empty frame it leaves. The editor tracks them, so a body with
      none is stored as it is, unread. */
  #storedHtml(html: string): string {
    if (this.#inlineImages()) return html;
    const editor = this.emailPane().editor();
    if (editor && !embeddedImages(editor.state).length) return html;
    return withoutEmbeddedImages(html);
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
          html: this.#storedHtml(message.html),
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

  /** The ⋮'s items, top to bottom: an email to study, first. */
  protected readonly moreItems = computed<ToolbarMenuItem<MoreAction>[]>(() => [
    { value: 'study', label: this.i18n.t('designer.study.import') },
  ]);

  /** A ⋮ item picked. */
  protected moreAction(action: MoreAction, studyPicker: HTMLInputElement): void {
    if (action === 'study') studyPicker.click();
  }

  /** The ⋮ item's picker: the file chosen, then the picker emptied so the
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
