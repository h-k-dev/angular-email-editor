import {
  Component,
  ElementRef,
  Injector,
  booleanAttribute,

  // Signals
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';

// Angular CDK
import { NgTemplateOutlet } from '@angular/common';
import { Portal } from '@angular/cdk/portal';
import { CdkTrapFocus } from '@angular/cdk/a11y';

// Angular Signal Forms
import {
  FieldTree,
  FormField,
  FormRoot,
  TreeValidationResult,
  form,
  submit,
  validate,
} from '@angular/forms/signals';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatFormField, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

// Aria
import { MenuTrigger } from '@angular/aria/menu';

// Angular File Drop
import { AngularFileDrop, FileDropEvent } from '@h-k-dev/angular-file-drop';

// Angular Email Editor
import {
  Editor,
  InlineImages,
  HEADING_LEVELS,
  MergeTagResolutionReport,
  PlaceholderWords,
  emailDocument,
  emailPlainText,
  plainTextHTML,
  importLoss,
  importedDocument,
  toInboundMessage,
} from '@h-k-dev/angular-email-editor';
import { isEmailAddress, parseMailbox } from '@h-k-dev/angular-email-editor/address';
import { injectPalette } from '@h-k-dev/angular-email-editor/palette';
import {
  AddressDragGroup,
  AddressInput,
  AddressInputLabel,
  addressList,
} from '@h-k-dev/angular-email-editor/address-input';
import {
  Attachment,
  AttachmentChip,
  AttachmentChipIcon,
  AttachmentKind,
} from '@h-k-dev/angular-email-editor/attachment-chip';
import { AttachmentChips } from '@h-k-dev/angular-email-editor/attachment-chips';
import {
  ToggleButtonGroup,
  ToggleButtonGroupIcon,
  ToggleButtonGroupText,
} from '@h-k-dev/angular-email-editor/toggle-button-group';
import { KeepFocus } from '@h-k-dev/angular-email-editor/focus';
import { ActionTrigger, injectActions } from '@h-k-dev/angular-email-editor/actions';
import { AddressFormField } from '@h-k-dev/angular-email-editor/material';
import { TranslatePipe } from '@ngx-translate/core';

import { DropHint } from '../drop-hint/drop-hint';
import {
  BodyFormat,
  EditorColorScheme,
  EmailCompose,
  SourceView,
} from '../email-compose/email-compose';
import {
  ToolbarMenu,
  ToolbarMenuRow,
} from '../email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';
import { EmailWriter, WriterBarPosition, writerBarOnTop } from '../email-writer/email-writer';
import { MarqueeStart } from '../paper-island';
import { releaseEditingSurface } from '../is-typing';
import { Viewport } from '../../../services/viewport';
import { Theme } from '../../../services/theme';
import { I18n } from '../../../services/i18n';
import { AttachmentUploads } from '../../../services/attachment-uploads';
import { EmailSend, SendRejected } from '../../../services/email-send';
import { BLANK, Envelope, hasContent, isBlank } from './envelope';

/** What the ⋮ menu's View toggle shows in the editor's place: the editor,
    or its HTML (code view). */
type EditorView = 'editor' | 'html';

/** Tells the sheets on one page apart: every sheet's Subject input needs an
    id of its own for its label. */
let nextSheetId = 0;

/** How the editor looks: light or dark of its own, or `auto` — the app's. */
type EditorAppearance = EditorColorScheme | 'auto';

/**
 * One message, and everything it is written with: the form over it, the
 * envelope rows as Gmail lays them out, the editor, the attachment strip,
 * and the writer's bar with Send and Discard. The composer page docks panes
 * around one of these; a compose window holds one of its own — so every
 * message in the app is written on the same sheet, whatever frames it.
 *
 * The sheet owns what a message needs and nothing a frame decides. It does
 * not keep a draft (the page adds `keepDraft`, see keep-draft.ts), does not
 * know where the HTML source is shown (the frame binds `sourceView` and the
 * code portal), and says what happened — `sent`, `discarded` — for the frame
 * to answer: the page starts over, a window closes.
 *
 * The frame may put its own controls into the writer's bar: `leading` ones
 * after the formatting switch, `actions` ones before Discard. The sheet's
 * `InlineImages` registry is the frame's — one per composer, shared with
 * whatever else the frame shows of the message (the page's preview).
 */
@Component({
  selector: 'div[message-form]',
  imports: [
    TranslatePipe,
    // Form
    FormField,
    FormRoot,

    // Components
    EmailWriter,
    EmailCompose,
    AddressDragGroup,
    AddressInput,
    AttachmentChips,
    AttachmentChip,
    AttachmentChipIcon,
    MatIcon,
    MatIconButton,
    DropHint,
    AngularFileDrop,
    KeepFocus,
    MarqueeStart,
    ActionTrigger,
    MenuTrigger,
    ToolbarMenu,
    ToolbarMenuRow,
    ToggleButtonGroup,
    ToggleButtonGroupIcon,
    ToggleButtonGroupText,

    // Material form fields (the `material` frame)
    MatFormField,
    MatPrefix,
    MatSuffix,
    AddressInputLabel,
    NgTemplateOutlet,
    MatInput,
    AddressFormField,
  ],
  templateUrl: './message-form.html',
  styleUrl: './message-form.scss',
  host: {
    '[attr.data-fields]': 'fields()',
  },
})
export class MessageForm {
  /** The upload store: the strip's chips read their progress from it, and a
      removed chip stops its transfer there. */
  readonly uploads = inject(AttachmentUploads);

  /** The chip's icon slot, filled with the app's own icon set: one Material
      Symbols ligature per kind the chip works out from the MIME type. */
  protected readonly attachmentIcons: Record<AttachmentKind, string> = {
    file: 'draft',
    document: 'description',
    pdf: 'picture_as_pdf',
    spreadsheet: 'table_chart',
    presentation: 'slideshow',
    archive: 'folder_zip',
    image: 'image',
    video: 'movie',
    audio: 'audio_file',
    message: 'mail',
  };
  readonly #transport = inject(EmailSend);
  /** The palette whose dark variants go out with the email. */
  readonly #palette = injectPalette();
  readonly #images = inject(InlineImages);
  readonly #injector = inject(Injector);
  protected readonly viewport = inject(Viewport);
  readonly #theme = inject(Theme);
  protected readonly i18n = inject(I18n);
  readonly #snackBar = inject(MatSnackBar);

  /** The body's editor, for the bar's own action buttons — read through an
      optional query, since the actions bind before the view exists. */
  private readonly pane = viewChild(EmailCompose);

  /** The bar heads the sheet (a phone, the zoomed window): its controls are
      laid out mirrored — Send at the end, Discard at the start — and the ⋮
      menu opens downward, lined up with its end. */
  protected readonly mirrored = computed(() => writerBarOnTop(this.bar(), this.viewport.compact()));

  /** The editor's actions the bar offers beside Send. */
  protected readonly actions = injectActions(() => this.pane()?.editor());

  /** Core's "Parse" is on the bar while it can run: placeholders to fill,
      and no evaluation under way. */
  protected readonly fillOffered = computed(
    () => this.actions.get('resolve-placeholders')?.disabled() === false,
  );

  /** The fill's key, as the platform spells Mod-Shift-Enter. */
  protected readonly fillShortcut = /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? '⇧⌘↩'
    : 'Ctrl+Shift+Enter';

  /** Says what the placeholder fill did: done, or how many came back
      without a value — those tokens are gone, and the user should look. */
  protected placeholdersFilled(report: MergeTagResolutionReport): void {
    const empty = report.empty.length;
    const message = empty
      ? this.i18n.t(`composer.placeholders.empty.${empty === 1 ? 'one' : 'other'}`, {
          count: empty,
        })
      : this.i18n.t('composer.placeholders.filled');
    this.#snackBar.open(message, undefined, { duration: 4000 });
  }

  protected placeholdersFailed(): void {
    this.#snackBar.open(this.i18n.t('composer.placeholders.failed'), undefined, { duration: 6000 });
  }

  /** The Subject input's id, unique on the page. */
  /** The body's empty-line words, Notion's set, in the language in use —
      built once per switch, so the editor redraws its placeholders then
      and never per keystroke. Table cells stay bare, as Notion's do. */
  protected readonly placeholders = computed<PlaceholderWords>(() => {
    const list = this.i18n.t('editor.placeholder.list');
    return {
      line: this.i18n.t('editor.placeholder.line'),
      heading: HEADING_LEVELS.map((level) => this.i18n.t('editor.placeholder.heading', { level })),
      quote: this.i18n.t('editor.placeholder.quote'),
      bulletList: list,
      orderedList: list,
      tableCell: '',
      image: this.i18n.t('editor.placeholder.image'),
    };
  });

  protected readonly subjectId = `message-subject-${nextSheetId}`;
  /** The ⋮ menu's View label's id, naming its toggle. */
  protected readonly viewLabelId = `message-view-${nextSheetId}`;
  /** The ⋮ menu's Format label's id, naming its toggle. */
  protected readonly formatLabelId = `message-format-${nextSheetId}`;
  /** The ⋮ menu's Theme label's id, naming its toggle. */
  protected readonly themeLabelId = `message-theme-${nextSheetId}`;
  /** The Preview text input's id, unique on the page. */
  protected readonly previewId = `message-preview-${nextSheetId++}`;

  /** What the sheet starts from — a reply's headers and quoted history, a
      message put back — instead of a new message. Given as the sheet is
      created, so the editor mounts with it: a value written in after the
      caret is in the editor would wait for the caret to leave. */
  readonly seed = input<Envelope | null>(null);

  /** Where the caret starts: To, where a new message starts, or `body` —
      the editor, for a reply whose rows are already filled. Only a mark:
      the element is `cdkFocusInitial`, and the focus trap that holds the
      sheet (a compose window's, capturing) puts the caret there. */
  readonly initialFocus = input<'to' | 'body'>('to');

  /** The message — one model, owned here as a real host would own it
      (seeded from an account, a reply's headers, a draft). Every row on the
      sheet binds to a field of it through the form below. Starts from the
      `seed`; writable from outside: a draft keeper seeds it, a frame may
      prefill it. */
  readonly message = linkedSignal<Envelope>(() => this.seed() ?? BLANK);

  /**
   * The form over the message. The rules are the ones a mail client
   * enforces before it lets go: one sender, at least one recipient and all
   * of them addresses, something in the body, and no attachment still on
   * its way up. Submission hands the validated message to the transport
   * (`#deliver`); a submit that fails validation puts the caret on the
   * first row that needs it (`#revealInvalid`). Every way to send — the
   * Send button, Enter in the subject, Mod-Enter and /send in the editor —
   * goes through `submit()`, so every one is validated the same way.
   */
  readonly envelope = form(
    this.message,
    (p) => {
      addressList(p.from, { max: 1 });
      addressList(p.to);
      addressList(p.cc, { min: 0 });
      addressList(p.bcc, { min: 0 });
      validate(p.html, ({ value }) =>
        hasContent(value())
          ? null
          : { kind: 'body.empty', message: 'Write something before sending' },
      );
      validate(p.attachments, ({ value }) =>
        value().some((attachment) => attachment.id === null)
          ? {
              kind: 'attachments.pending',
              message: 'Still attaching — wait for the uploads to finish',
            }
          : null,
      );
    },
    {
      name: 'message',
      submission: {
        action: (field) => this.#deliver(field),
        onInvalid: (field) => this.#revealInvalid(field),
      },
    },
  );

  /**
   * Canonical email HTML — the form's `html` field, as the signal the panes
   * bind to. The email composer publishes what its schema serializes (it is
   * the field's control); an HTML source pane publishes raw source here,
   * which the email composer parses and canonicalizes back. A write lands in
   * the message, and reads come from it: the model is the one source of
   * truth.
   */
  readonly html = linkedSignal<string, string>({
    source: () => this.message().html,
    computation: (html) => html,
    set: (html) => this.message.update((m) => (m.html === html ? m : { ...m, html })),
  });

  /** The HTML as it came in — the source pane's text as pasted or typed, an
      example loaded whole — before the editor read it; null for a message
      written here. Kept on the message, so the preview can draw it beside
      the editor's reading for each client. */
  readonly original = linkedSignal<string | null, string | null>({
    source: () => this.message().original,
    computation: (original) => original,
    set: (original) =>
      this.message.update((m) => (m.original === original ? m : { ...m, original })),
  });

  /** The quoted history a reply or forward answers — beside `html`, never
      replaced with it; the editor's trash and Edit are the only ways it
      changes on the sheet. */
  readonly quoted = linkedSignal<string | null, string | null>({
    source: () => this.message().quoted,
    computation: (quoted) => quoted,
    set: (quoted) => this.message.update((m) => (m.quoted === quoted ? m : { ...m, quoted })),
  });

  /** Where the frame shows the HTML source; the editor steps out of code
      view by writing it. */
  readonly sourceView = model<SourceView>('hidden');

  /** The frame's code-view portal and the source editor inside it, when the
      frame has a source pane. */
  readonly codePortal = input<Portal<unknown> | null>(null);
  readonly codeEditor = input<Editor | undefined>();

  /** Whether the frame has a source pane to switch to: the ⋮ menu then
      offers the View — the editor, or its HTML in the editor's place. */
  readonly sourceViews = input(false, { transform: booleanAttribute });

  /** How the envelope rows frame their controls: `plain` — the control
      alone in the row (the page); `material` — inside an Angular Material
      form field at density -4, exactly the row's 40px (a compose window).
      The two look the same; the form field adds its error styling — the red
      line under an invalid control — and no message: iusta core's rows. */
  readonly fields = input<'plain' | 'material'>('plain');
  protected readonly material = computed(() => this.fields() === 'material');

  /** Where the writer's bar sits (`EmailWriter.bar`): the viewport's call
      by default; a frame that is a document heads the sheet with it. */
  readonly bar = input<WriterBarPosition>('auto');

  /** A send went through — the receipt, as the page's status strip words
      it. The sheet has started over by then. */
  readonly sent = output<string>();

  /** The bar's Discard was pressed. The sheet has started over by then. */
  readonly discarded = output<void>();

  /** The sheet started over — after a send or a discard. */
  readonly cleared = output<void>();

  /** Whether the formatting toolbar is switched on (the writer bar's
      formatting options button). Off by default: the message is written
      first, and the marks have their keys, the bubble menu and the `/`
      menu; the bar is one press away when it is wanted. */
  protected readonly formattingOpen = signal(false);

  /** Whether the composer's formatting toolbar shows. Always on a phone:
      there it is the bar on the keyboard, and the bar has no switch for it.
      A choice made on a wide screen is kept for when the screen is wide
      again. */
  protected readonly toolbarShown = computed(
    () => !this.plainText() && (this.viewport.compact() || this.formattingOpen()),
  );

  /** What the message is written and sent as — the ⋮ menu's Format:
      HTML, or plain text (lines, sent as `text/plain` alone). */
  protected readonly bodyFormat = computed<BodyFormat>(() => this.message().format);
  protected readonly plainText = computed(() => this.bodyFormat() === 'text');

  /** The HTML a switch to plain text left, and the text it became: back to
      HTML with that text untouched brings the formatting back; once the
      text is edited, the edited text goes back as it is. */
  #beforePlain: { html: string; text: string } | null = null;

  /**
   * The Format toggle. To plain text: the body is read down to its text
   * (`emailPlainText` — lists keep their bullets, quotes their `>`, links
   * their URL) and written as lines (`plainTextHTML`); the editor mounts
   * on the plain-text kit, and the HTML source steps aside — a plain-text
   * message has none to show. No dialog in front of the loss: back to HTML
   * before the text changes restores the formatting as it was.
   */
  protected onFormat(format: BodyFormat): void {
    if (format === this.bodyFormat()) return;
    releaseEditingSurface();
    const message = this.message();
    if (format === 'text') {
      const text = emailPlainText(message.html);
      this.#beforePlain = { html: message.html, text };
      if (this.sourceView() === 'code') this.sourceView.set('hidden');
      this.message.set({ ...message, format, html: plainTextHTML(text) });
      return;
    }
    const kept = this.#beforePlain;
    const untouched = kept !== null && emailPlainText(message.html) === kept.text;
    this.#beforePlain = null;
    this.message.set({ ...message, format, html: untouched ? kept.html : message.html });
  }

  /** The editor's appearance, the ⋮ menu's toggle: a light or dark of its
      own, apart from the app's theme — the text's paper only — or `auto`,
      the app's, following its top-bar toggle. Auto by default: the message
      sits in the app as the rest of it does; Light shows it as it is
      sent. */
  protected readonly editorAppearance = signal<EditorAppearance>('auto');

  /** The scheme the editor draws in: the appearance, with `auto` read as
      the app's theme of the moment. Public for a frame that makes more than
      the text wear it (a `PaperIsland`, the zoomed window). */
  readonly editorScheme = computed<EditorColorScheme>(() => {
    const appearance = this.editorAppearance();
    return appearance === 'auto' ? this.#theme.scheme() : appearance;
  });

  /** The bar's ⋮ menu offers its View row — the editor or its HTML — where
      the frame has a source pane and the screen room for it, and the
      message is HTML. The Format and Theme rows are always there
      (message-form.html). */
  readonly viewOffered = computed(
    () => this.sourceViews() && !this.viewport.compact() && !this.plainText(),
  );

  /** The View toggle's pick: the HTML in the editor's place (code view), or
      the editor — the docked source beside it included. */
  protected readonly editorView = computed<EditorView>(() =>
    this.sourceView() === 'code' ? 'html' : 'editor',
  );

  /** The View toggle: moves the source into the editor's place or out of
      it (from the docked view too, as the old </> did) — nothing for the
      view already in effect. */
  protected onEditorView(view: EditorView): void {
    if (view === this.editorView()) return;
    releaseEditingSurface();
    this.sourceView.set(view === 'html' ? 'code' : 'hidden');
  }

  readonly emailPane = viewChild.required(EmailCompose);

  /** The copy rows, for putting the caret in one the moment it opens. They
      exist only while shown. */
  protected readonly ccField = viewChild<AddressInput>('ccField');
  protected readonly bccField = viewChild<AddressInput>('bccField');

  /** The To row: where a message starts, so the caret lands there on
      arrival. */
  protected readonly toField = viewChild<AddressInput>('toField');

  /** From and Subject, by reference: their rows forward clicks and name
      them, whichever frame the control sits in. From (like To) is optional:
      its label reads it in the very pass that creates it. */
  protected readonly fromField = viewChild<AddressInput>('fromField');
  protected readonly subjectField =
    viewChild.required<ElementRef<HTMLInputElement>>('subjectField');

  constructor() {
    // Where the caret starts is marked, not done, where a focus trap that
    // captures holds the sheet (a compose window): the CDK's initial focus
    // puts it on the `cdkFocusInitial` element as the trap starts, and hands
    // it back where it was when the trap goes. A sheet on its own (the
    // page) puts it in To itself — focus is a DOM write: the write phase,
    // batched ahead of the reads of the same pass (the toolbar measuring
    // itself).
    if (!inject(CdkTrapFocus, { optional: true })?.autoCapture) {
      afterNextRender({ write: () => this.focus() });
    }
  }

  /** Puts the caret in To, where a message starts. */
  focus(): void {
    this.toField()?.focus();
  }

  /** Nothing written — the message is as it started. */
  readonly blank = computed(() => isBlank(this.message()));

  /** The bar's Discard: the sheet starts over. No confirmation — an empty
      sheet is one click from a new message, and a dialog in front of every
      discard is a tax on the common case. */
  protected discard(): void {
    this.#startOver();
    this.discarded.emit();
  }

  /** A fresh message: the rows and the body cleared, the form untouched
      again, and the caret back in To. */
  #startOver(): void {
    for (const attachment of this.message().attachments) this.uploads.cancel(attachment.key);
    // An editor being typed in defers an external write until it is left —
    // after Mod-Enter the body is: leave it, so the sheet clears now.
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.envelope().reset(BLANK);
    this.ccOpen.set(false);
    this.bccOpen.set(false);
    this.previewOpen.set(false);
    this.cleared.emit();
    // A new message starts at To, whatever the sheet first opened on.
    afterNextRender({ write: () => this.toField()?.focus() }, { injector: this.#injector });
  }

  /**
   * Cc and Bcc the way Gmail does them: two text buttons at the end of the
   * To row, each opening its own row (focused) and stepping aside; a row
   * that is left empty when focus moves elsewhere folds back into its
   * button. A row with addresses in it stays whatever the button state, so
   * a message seeded with a Cc shows it from the start.
   */
  protected readonly ccOpen = signal(false);
  protected readonly bccOpen = signal(false);
  protected readonly showCc = computed(() => this.ccOpen() || this.message().cc.length > 0);
  protected readonly showBcc = computed(() => this.bccOpen() || this.message().bcc.length > 0);

  protected openCopy(which: 'cc' | 'bcc'): void {
    (which === 'cc' ? this.ccOpen : this.bccOpen).set(true);
    afterNextRender(
      { write: () => (which === 'cc' ? this.ccField() : this.bccField())?.focus() },
      { injector: this.#injector },
    );
  }

  /**
   * Preview text — the inbox snippet — the way Cc and Bcc work: a text
   * button at the end of the Subject row opens its own row (focused) and
   * steps aside; left empty, the row folds back into the button when focus
   * moves on. A personal mail never needs it, so it stays out of the way; a
   * newsletter writer finds it one click from the subject.
   */
  protected readonly previewOpen = signal(false);
  protected readonly showPreview = computed(
    () => !this.plainText() && (this.previewOpen() || this.message().previewText.length > 0),
  );
  protected readonly previewField = viewChild<ElementRef<HTMLInputElement>>('previewField');

  protected openPreview(): void {
    this.previewOpen.set(true);
    afterNextRender(
      { write: () => this.previewField()?.nativeElement.focus() },
      { injector: this.#injector },
    );
  }

  /** Focus left the preview row: an empty one folds. */
  protected leavePreview(): void {
    if (!this.message().previewText) this.previewOpen.set(false);
  }

  /**
   * The recipients merge the way Gmail's do: while focus is anywhere else,
   * To, Cc and Bcc show as one line — the names, the copies after their
   * label — and focus coming back into any of them opens the rows again.
   * The rows are never unmounted, only visually hidden: Tab still lands in
   * them, and the form's focus-on-invalid still finds its control, and
   * either way the focus is what opens them. The line itself is a pointer
   * shortcut to To, hidden from assistive tech, which reaches the rows.
   */
  protected readonly recipientsActive = signal(false);

  /** Merged only while there is something to merge: a copy row beside To.
      A lone To row already reads as a line when it is not focused, and
      swapping it for a lookalike would only move its placeholder. */
  protected readonly recipientsMerged = computed(
    () => !this.recipientsActive() && (this.showCc() || this.showBcc()),
  );

  /** The merged line's groups, To first; empty groups left out. The first
      group's label is the row's label, the rest are inline. */
  protected readonly recipientSummary = computed(() => {
    const { to, cc, bcc } = this.message();
    const person = (raw: string) => {
      const mailbox = parseMailbox(raw);
      return { raw, text: mailbox.name ?? mailbox.address, valid: isEmailAddress(mailbox.address) };
    };
    return [
      { label: 'To', people: to.map(person) },
      { label: 'Cc', people: cc.map(person) },
      { label: 'Bcc', people: bcc.map(person) },
    ].filter((group) => group.people.length);
  });

  /** A press on a row anywhere but on a control — the label, the padding —
      leaves focus where it is; the row's click puts the caret in its
      control. Without this the press would take focus to the body for an
      instant, and an address row would drop from chips to text and back in
      a flash. */
  protected readonly rowControls = 'input, button, textarea';

  /** Focus left the recipients — To, Cc and Bcc together — for somewhere
      else: the rows merge into one line, and the empty copy rows fold.
      Moving between the three never does. */
  protected leaveRecipients(event: FocusEvent): void {
    const group = event.currentTarget as HTMLElement;
    // Only a real destination outside the group counts: focus going nowhere
    // (the window losing focus, a focused element removed) folds nothing.
    const destination = event.relatedTarget as Node | null;
    if (!destination || group.contains(destination)) return;
    this.recipientsActive.set(false);
    const { cc, bcc } = this.message();
    if (!cc.length) this.ccOpen.set(false);
    if (!bcc.length) this.bccOpen.set(false);
  }

  /** Live word/line counter, measured mathematically by the email pane. */
  readonly metrics = computed(() => this.emailPane().bodyMetrics());

  /** The form's first complaint — once the user has been through a row or
      has tried to send (the form is touched), never before: a sheet that
      shouts on arrival is not a sheet anyone writes on. */
  readonly problem = computed(() => {
    const state = this.envelope();
    if (!state.touched() || !state.invalid()) return null;
    return state.errorSummary()[0]?.message ?? null;
  });

  /**
   * A file dropped on the editing surface is an attachment — including an
   * `.eml`, which there means "send this message along", not "open it".
   * Opening is the frame's gesture, if it has one (the page's zone, one out).
   *
   * Only drops the editor did not claim arrive here: ProseMirror takes a
   * pure-image drop and embeds it inline, so images alone are content and
   * anything else — a PDF, or an image among other files — is an attachment.
   */
  protected onAttachmentDrop(event: FileDropEvent): void {
    const dropped = event.files.map(({ file }) => file);
    if (dropped.length) this.attach(dropped);
  }

  /** Hands files to the store and keeps only their references — upload on
      drop, as a real host does. Each reference gets its id when its transfer
      settles; a chip removed before then has taken its reference with it,
      and the id has nowhere to land. */
  attach(files: readonly Attachment[]): void {
    const refs = files.map((file) => this.uploads.start(file));
    this.message.update((m) => ({ ...m, attachments: [...m.attachments, ...refs] }));
    for (const ref of refs) {
      void this.uploads.whenDone(ref.key).then((id) =>
        this.message.update((m) =>
          m.attachments.some((a) => a.key === ref.key)
            ? {
                ...m,
                attachments: m.attachments.map((a) => (a.key === ref.key ? { ...a, id } : a)),
              }
            : m,
        ),
      );
    }
  }

  /**
   * Opens an .eml as this message: its body replaces what is written, its
   * inline parts go to the registry, the rest of its parts to the strip.
   * Resolves to a note on what came in and what did not.
   *
   * MIME parsing is postal-mime's job (bring-your-own-parser is the
   * library's stance — `toInboundMessage` is the whole bridge);
   * lazy-imported so the parser costs nothing until the first drop. A File
   * is a Blob, so it goes to the parser as raw bytes (correct charsets, no
   * lossy .text() step).
   */
  async importEml(dropped: File): Promise<string> {
    try {
      const { default: PostalMime } = await import('postal-mime');
      const parsed = await PostalMime.parse(dropped);
      const inbound = toInboundMessage(parsed);
      // The message's inline parts go into the registry *before* the document,
      // so every `cid:` resolves the moment its node view mounts.
      // A part the body references by `cid:` is inline content and goes to
      // the registry; everything else is an attachment and goes to the strip
      // under the body. The same split the payload makes at send time
      // (multipart/related vs multipart/mixed), made once here.
      let inlineParts = 0;
      const attached: Attachment[] = [];
      for (const part of parsed.attachments ?? []) {
        const cid = part.contentId?.replace(/^<|>$/g, '');
        if (!cid || !part.content) {
          attached.push({
            name: part.filename || 'attachment',
            type: part.mimeType || undefined,
            size: typeof part.content === 'string' ? undefined : part.content?.byteLength,
          });
          continue;
        }
        this.#images.add(
          new Blob([part.content as BlobPart], {
            type: part.mimeType || 'application/octet-stream',
          }),
          cid,
        );
        inlineParts++;
      }
      // The imported message's attachments replace what was attached: the
      // transfers still running for the old ones are stopped with them.
      for (const attachment of this.message().attachments) this.uploads.cancel(attachment.key);
      this.message.update((m) => ({ ...m, attachments: [] }));
      this.attach(attached);
      // A drop must import immediately: release editor focus first (the
      // pane's blur catch-up would apply it eventually anyway — this makes
      // "eventually" be "now").
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.html.set(importedDocument(inbound));

      // Legibility of loss: say what the import dropped instead of losing it
      // silently — schema-side loss from the library, MIME-side from the parser.
      const loss = importLoss(inbound);
      const attachments = parsed.attachments?.length ?? 0;
      const notes = [`Imported ${dropped.name}${inbound.subject ? ` — “${inbound.subject}”` : ''}`];
      if (loss.removedElements) {
        notes.push(
          `${loss.removedElements} element${loss.removedElements === 1 ? '' : 's'} outside the ` +
            `schema removed (${loss.removedTags.slice(0, 3).join(', ')})`,
        );
      }
      if (loss.inlineImages) {
        const missing = Math.max(0, loss.inlineImages - inlineParts);
        notes.push(
          `${inlineParts} inline image${inlineParts === 1 ? '' : 's'} restored from the message` +
            (missing ? ` (${missing} missing)` : ''),
        );
      }
      const ignored = attachments - inlineParts;
      if (ignored > 0) {
        notes.push(`${ignored} attachment${ignored === 1 ? '' : 's'} kept`);
      }
      return notes.join(' · ');
    } catch {
      return `Couldn't read ${dropped.name} as an email`;
    }
  }

  /** The editor's own ways in — Mod-Enter, /send — submit the form exactly
      as the Send button does: one path, validated. */
  protected send(): void {
    void submit(this.envelope);
  }

  /** The submit action: the validated message goes to the transport. A
      rejection the server pins on an address comes back as an error on the
      To row — the round trip a real backend's answer takes. */
  async #deliver(field: FieldTree<Envelope>): Promise<TreeValidationResult> {
    const intent = this.emailPane().intent();
    if (!intent) return { kind: 'editor.unready', message: 'The editor is still loading' };
    const { from, to, cc, bcc, subject, previewText, format, attachments } = field().value();
    const html = format === 'html';
    try {
      const receipt = await this.#transport.send({
        ...intent,
        // Plain text goes as its text alone: no HTML part, nothing inline.
        format,
        html: html ? intent.html : '',
        inlineImages: html ? intent.inlineImages : [],
        // No `lang`: the app's language is the reader's UI, not the
        // message's — the article's `dir="auto"` still reads the text.
        document: html
          ? emailDocument(intent.html, { title: subject, previewText, darkMode: this.#palette })
          : null,
        from,
        to,
        cc,
        bcc,
        subject,
        attachments,
      });
      const kb = (new TextEncoder().encode(receipt.message.html).length / 1024).toFixed(1);
      const parts = receipt.message.inlineImages.length;
      const note =
        `Sent ${receipt.id} · to ${to.length} recipient${to.length === 1 ? '' : 's'}` +
        (subject ? ` · “${subject}”` : ' · no subject') +
        (previewText ? ' · preview text' : '') +
        (html ? ` · ${kb} kB HTML` : ' · plain text only') +
        ` · ${intent.text.length} chars text` +
        (parts
          ? ` · ${parts} inline image${parts === 1 ? '' : 's'} as cid: part${parts === 1 ? '' : 's'}`
          : '') +
        (attachments.length
          ? ` · ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
          : '');
      // Sent: the message has done its job.
      this.#startOver();
      this.sent.emit(note);
      return null;
    } catch (error) {
      if (error instanceof SendRejected) {
        // Pinned on the row that holds the address the server refused.
        const { cc, bcc } = field().value();
        const row = cc.includes(error.address)
          ? field.cc
          : bcc.includes(error.address)
            ? field.bcc
            : field.to;
        return { kind: 'send.rejected', message: error.message, fieldTree: row };
      }
      throw error;
    }
  }

  /** A submit that failed validation: the caret goes to the control bound
      to the first field with an error — the form's own order is the sheet's
      reading order, and every control knows how to take focus (a native
      input natively, the address input and the editor pane through their
      `focus()`; the editor pane also steps out of code view for it). The
      frame says what for (`problem`). An attachment still uploading has no
      control to focus — the note is the whole answer. */
  #revealInvalid(field: FieldTree<Envelope>): void {
    field().errorSummary()[0]?.fieldTree().focusBoundControl();
  }
}
