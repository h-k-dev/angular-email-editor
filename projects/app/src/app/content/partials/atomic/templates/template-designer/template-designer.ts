import {
  Component,
  ElementRef,

  // Signals
  afterRenderEffect,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

// Angular CDK
import { DomPortal } from '@angular/cdk/portal';

// Angular Signal Forms
import { FormField } from '@angular/forms/signals';

// Angular Material
import { MatButton, MatIconButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';

// Angular File Drop
import { AngularFileDrop } from '@h-k-dev/angular-file-drop';

// Angular Email Editor
import {
  InlineImages,
  PAGE_SPACING_MAX,
  PAGE_WIDTH_MAX,
  PAGE_WIDTH_MIN,
  PageLayout,
  centeredPageLayout,
  emailBackgroundPalette,
  pageLayoutOf,
  samePageLayout,
} from '@h-k-dev/angular-email-editor';
import { editorState } from '@h-k-dev/angular-email-editor/actions';
import { AttachmentChip, AttachmentChipIcon } from '@h-k-dev/angular-email-editor/attachment-chip';
import { AttachmentChips } from '@h-k-dev/angular-email-editor/attachment-chips';
import {
  ToggleButtonGroup,
  ToggleButtonGroupText,
} from '@h-k-dev/angular-email-editor/toggle-button-group';
import { TranslatePipe } from '@ngx-translate/core';

import { BLANK, Envelope } from '../../../../../core/email/envelope';
import { DIALECT_NAMES, EmailTemplate, Templates } from '../../../../../core/email/templates';
import { Badge } from '../../../common/badge/badge';
import { PageHeader } from '../../../common/page-header/page-header';
import { PhoneFrame } from '../../../common/phone-frame/phone-frame';
import { OverflowRow } from '../../../common/overflow-row/overflow-row';
import { MailView } from '../../../shared/email/mail-view/mail-view';
import { ScrollOwner } from '../../../../../core/directives/scroll-owner/scroll-owner';
import { SplitHandle } from '../../../common/split-handle/split-handle';
import { atRest } from '../../../shared/email/at-rest';
import { EmailCompose } from '../../../shared/email/email-compose/email-compose';
import { ColorPalette } from '../../../shared/email/email-compose/formatting-toolbar/color-palette/color-palette';
import { HtmlEmailCompose } from '../../../shared/email/html-email-compose/html-email-compose';
import { EnvelopeRows } from '../../../shared/email/message-form/envelope-rows/envelope-rows';
import { MessageMenu } from '../../../shared/email/message-form/message-menu/message-menu';
import { MessageSheet } from '../../../shared/email/message-form/message-sheet';
import {
  IslandMarquee,
  MarqueeStart,
  PaperIsland,
  PaperIslandDirective,
} from '../../../shared/email/paper-island';
import { TemplateDesignerData } from './open-template-designer';

/** The phone's screen, px — the phone frame's own default. */
const PHONE_WIDTH = 375;

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
 * - The canvas: the editor in the email's 600px column, its layout blocks
 *   taking their gestures (design, never write) and the formatting toolbar
 *   always there.
 * - On the right, three outlined blocks: the message's rows — From, To,
 *   Cc, Bcc, Subject, Preview — its attachments, and its layout, each
 *   folding to its heading on its own.
 * - The layout is the email's page (the library's `PageLayout`): none, or
 *   a centred column of a width on a page colour, the column's own colour
 *   over it — set only here, a step of the editor's, so undo takes it back.
 *   The page shows inside the email's own column (720px), round the
 *   layout's: the container is the bound, never the canvas.
 * - The phone: the message as the inbox shows it received on a 375px phone
 *   — the very `mail-view` the reader uses, which lays itself out by the
 *   room the phone gives it — live as typing settles, on the light paper
 *   and the dark at once: a divider down the screen parts the two, and
 *   slides to show all of either. On when asked for,
 *   centred in the room left of the email's column; it pushes the column
 *   only where that room is too narrow to hold it.
 * - Its HTML: the bar's </> puts the source in the editor's place (code
 *   view, the compose page's same pane) and back.
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
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
    AngularFileDrop,
    AttachmentChips,
    AttachmentChip,
    AttachmentChipIcon,
    EmailCompose,
    HtmlEmailCompose,
    EnvelopeRows,
    MessageMenu,
    MarqueeStart,
    ScrollOwner,
    SplitHandle,
    PaperIslandDirective,
    MailView,
    Badge,
    PageHeader,
    PhoneFrame,
    OverflowRow,
    ToggleButtonGroup,
    ToggleButtonGroupText,
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
  host: {
    '[attr.data-paper-scheme]': 'scheme()',
    '[attr.data-phone]': 'phoneOpen() || null',
    '(keydown)': 'shortcut($event)',
  },
})
export class TemplateDesigner extends MessageSheet implements PaperIsland {
  readonly #ref = inject<MatDialogRef<TemplateDesigner>>(MatDialogRef);
  readonly #templates = inject(Templates);
  readonly #snack = inject(MatSnackBar);

  /** The island's element (`PaperIsland`): the whole designer — the
      editor's marquee draws across it. */
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly marquee = new IslandMarquee();
  /** The island's paper: the message's Appearance (the ⋮ menu's). */
  readonly scheme = computed(() => this.editorScheme());

  protected readonly barAtTop = signal(true).asReadonly();

  /** The template as last stored — what Revert goes back to, and what Save
      writes over. */
  readonly #template = signal(inject<TemplateDesignerData>(MAT_DIALOG_DATA).template);
  protected readonly name = computed(() => this.#template().name);
  /** Its category tag: the dialect its tokens are written in. */
  protected readonly tag = computed(() => DIALECT_NAMES[this.#template().dialect]);

  /** A template was stored — the gallery redraws its card. */
  readonly saved = output<EmailTemplate>();

  /** The message as it was last saved, read once the editor has its
      reading of the body (the schema's canonical form — the template's HTML
      as stored may be spelled otherwise): null until then, so nothing reads
      as a change before the editor has said what the body is. */
  readonly #clean = signal<Envelope | null>(null);

  /** Anything changed since the last save. */
  readonly dirty = computed(() => {
    const clean = this.#clean();
    return clean !== null && !sameMessage(this.message(), clean);
  });

  protected readonly saving = signal(false);

  /** The phone on the left of the canvas. */
  protected readonly phoneOpen = signal(false);

  /** The phone's screen, px: the narrowest a message is still read on. */
  protected readonly phoneWidth = PHONE_WIDTH;
  /** The papers the phone reads the mail on, left to right of its divider. */
  protected readonly papers = ['light', 'dark'] as const;
  /** Where the divider stands, px from the screen's left: the light paper
      to the left of it, the dark to the right — half and half to start. */
  protected readonly phoneSplit = signal(PHONE_WIDTH / 2);

  /** Which of the details shows on the right, picked by its chip: the
      envelope — the message's rows and its files — or the page layout. The
      other stays, hidden, its state kept. */
  protected readonly detailsPanel = signal<'envelope' | 'layout'>('envelope');
  protected readonly detailsPanels = ['envelope', 'layout'] as const;

  /** The details' blocks on the right — the rows, the files, the layout —
      each open, or folded to its heading. */
  protected readonly messageOpen = signal(true);
  protected readonly filesOpen = signal(true);
  protected readonly layoutOpen = signal(true);

  /** The email's page layout, as its editor holds it — null for none. The
      same layout reads as no change, so a keystroke redraws nothing here. */
  readonly #editorState = editorState(() => this.emailPane().editor());
  protected readonly pageLayout = computed(
    () => {
      const state = this.#editorState();
      return state ? pageLayoutOf(state) : null;
    },
    { equal: samePageLayout },
  );
  protected readonly backgroundPalette = emailBackgroundPalette;
  protected readonly widthMin = PAGE_WIDTH_MIN;
  protected readonly widthMax = PAGE_WIDTH_MAX;
  protected readonly spacingMax = PAGE_SPACING_MAX;

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

    // The clean state is the editor's first reading of the template: once
    // it has mounted (and published its canonical body), the message as it
    // stands then.
    afterRenderEffect(() => {
      if (!this.emailPane().editor() || untracked(this.#clean)) return;
      this.#clean.set(untracked(this.message));
    });

    // Nothing unsaved is lost to a stray Escape (the dialog fills the
    // screen: there is no backdrop to press beside it).
    effect(() => (this.#ref.disableClose = this.dirty()));
  }

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

  /** The bar's </>: the HTML in the editor's place, or the editor back. */
  protected toggleSource(): void {
    this.onEditorView(this.editorView() === 'html' ? 'editor' : 'html');
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

  /** Stores the template as it stands. */
  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    const message = this.message();
    const { from, to, cc, bcc, subject, previewText, attachments } = message;
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
    } finally {
      this.saving.set(false);
    }
  }

  /** Back to the template as last saved — no confirmation: it is one
      press, and what it throws away is what the press says. */
  protected revert(): void {
    const clean = this.#clean();
    if (!clean) return;
    // A focused editor holds an outside write until it is left.
    (document.activeElement as HTMLElement | null)?.blur?.();
    for (const file of this.message().attachments) {
      if (!clean.attachments.some((kept) => kept.key === file.key)) this.uploads.cancel(file.key);
    }
    this.message.set(clean);
  }

  /** The layout's kind: a centred column — the one it had, else the
      newsletter's default — or none. */
  protected setLayoutKind(kind: string): void {
    this.#setLayout(kind === 'centered' ? (this.pageLayout() ?? centeredPageLayout()) : null);
  }

  /** The column's width, as the field says it — snapped to its grid. */
  protected setLayoutWidth(value: string): void {
    const layout = this.pageLayout();
    if (layout && value.trim()) this.#setLayout({ ...layout, width: Number(value) });
  }

  /** The page's room above and below the column, as the field says it —
      snapped to its grid; an empty field is none. */
  protected setLayoutSpacing(value: string): void {
    const layout = this.pageLayout();
    if (layout) this.#setLayout({ ...layout, spacing: Number(value) || 0 });
  }

  protected setPageColor(background: string | null): void {
    const layout = this.pageLayout();
    if (layout) this.#setLayout({ ...layout, background });
  }

  protected setColumnColor(columnBackground: string | null): void {
    const layout = this.pageLayout();
    if (layout) this.#setLayout({ ...layout, columnBackground });
  }

  /** A step of the editor's: the body publishes it, and undo takes it back. */
  #setLayout(layout: PageLayout | null): void {
    this.emailPane().editor()?.commands['setPageLayout'](layout);
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
