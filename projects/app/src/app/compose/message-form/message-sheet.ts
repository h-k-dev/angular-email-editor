import {
  Directive,
  Injector,
  Signal,
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
import { Portal } from '@angular/cdk/portal';
import { CdkTrapFocus, LiveAnnouncer } from '@angular/cdk/a11y';

// Angular Signal Forms
import { FieldTree, TreeValidationResult, form, submit, validate } from '@angular/forms/signals';

// Angular Material
import { MatSnackBar } from '@angular/material/snack-bar';
import type { TooltipPosition } from '@angular/material/tooltip';

// Angular File Drop
import { FileDropEvent } from '@h-k-dev/angular-file-drop';

// Angular Email Editor
import {
  Editor,
  InlineImages,
  HEADING_LEVELS,
  LayoutInteractivity,
  MergeTagResolutionReport,
  PlaceholderWords,
  emailDocument,
  emailPlainText,
  plainTextHTML,
  importLoss,
  importedDocument,
  toInboundMessage,
} from '@h-k-dev/angular-email-editor';
import { injectPalette } from '@h-k-dev/angular-email-editor/palette';
import { addressList } from '@h-k-dev/angular-email-editor/address-input';
import { Attachment, AttachmentKind } from '@h-k-dev/angular-email-editor/attachment-chip';
import { injectActions } from '@h-k-dev/angular-email-editor/actions';

import {
  BodyFormat,
  EditorColorScheme,
  EmailCompose,
  SourceView,
} from '../email-compose/email-compose';
import { releaseEditingSurface } from '../is-typing';
import { Theme } from '../../../services/theme';
import { I18n } from '../../../services/i18n';
import { AttachmentRef, AttachmentUploads } from '../../../services/attachment-uploads';
import { EmailSend, SendRejected } from '../../../services/email-send';
import { Preferences } from '../../../services/preferences';
import { EnvelopeRows } from './envelope-rows/envelope-rows';
import { BLANK, Envelope, hasContent, isBlank } from './envelope';

/** What the settings' View toggle shows in the editor's place: the editor,
    or its HTML (code view). */
export type EditorView = 'editor' | 'html';

/** How the editor looks: light or dark of its own, or `auto` — the app's. */
export type EditorAppearance = EditorColorScheme | 'auto';

/** What the frame writes the message for. `design`: the layout is the
    writer's to shape — the compose page's desk, beside its source and
    preview. `write`: words into a layout already settled — a compose
    window, zoomed or not, and every phone — where a grip under the caret
    is in the way. Sets defaults (the layout blocks' gestures, today); the
    settings still override them for the message. */
export type EditingMode = 'design' | 'write';

/** What a compose window or the page writes a message on: the desktop
    sheet (`MessageForm`) or the phone's (`MobileMessageForm`). Chosen once,
    as the message opens, and kept until it closes. */
export type MessageSheetKind = 'desktop' | 'mobile';

/** Tells the sheets on one page apart: the attachment strip needs an id of
    its own for the attach button's `aria-controls`. */
let nextSheetId = 0;

/**
 * One message, and everything it is written with: the form over it, the
 * envelope rows, the editor, the attachment strip, Send and Discard — the
 * controller both sheets share. The desktop sheet (`MessageForm`) and the
 * phone's (`MobileMessageForm`) are this and a template each: the logic of
 * a message is written once, and how each screen lays it out is the
 * template's alone, so neither carries a branch for the other's screen.
 *
 * Each sheet provides itself under this class, so what works with "the
 * sheet" — the frame around it (the page, a compose window), the draft
 * keeper (keep-draft.ts), the settings inside (`MessageSettings`) — asks for a
 * `MessageSheet` and never knows which one it got.
 *
 * The sheet owns what a message needs and nothing a frame decides. It does
 * not keep a draft (the page adds `keepDraft`), does not know where the
 * HTML source is shown (the frame binds `sourceView` and the code portal),
 * and says what happened — `sent`, `discarded` — for the frame to answer:
 * the page starts over, a window closes.
 *
 * The sheet's `InlineImages` registry is the frame's — one per composer,
 * shared with whatever else the frame shows of the message (the page's
 * preview).
 */
@Directive()
export abstract class MessageSheet {
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
  readonly #theme = inject(Theme);
  readonly #preferences = inject(Preferences);
  protected readonly i18n = inject(I18n);
  readonly #snackBar = inject(MatSnackBar);
  readonly #announcer = inject(LiveAnnouncer);

  /** The body's editor pane. */
  readonly emailPane = viewChild.required(EmailCompose);

  /** The envelope rows: where the caret starts, and what starts over. */
  protected readonly rows = viewChild.required(EnvelopeRows);

  /** The editor's actions the bar offers beside Send — read through an
      optional query, since the actions bind before the view exists. */
  private readonly pane = viewChild(EmailCompose);
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

  /** How the envelope rows frame their controls (`EnvelopeRows.fields`):
      bare on the page, Material form fields in a compose window. */
  readonly fields = input<'plain' | 'material'>('plain');

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

  /** Whether the frame has a source pane to switch to: the settings then
      offer the View — the editor, or its HTML in the editor's place. A
      phone's sheet never does. */
  readonly sourceViews = input(false, { transform: booleanAttribute });

  /** What the frame writes the message for (`EditingMode`): `write`
      unless the frame is a design desk — the compose page's. */
  readonly mode = input<EditingMode>('write');

  /** A send went through — the receipt, as the page's status strip words
      it. The sheet has started over by then. */
  readonly sent = output<string>();

  /** The bar's Discard was pressed. The sheet has started over by then. */
  readonly discarded = output<void>();

  /** The sheet started over — after a send or a discard. */
  readonly cleared = output<void>();

  /** What the message is written and sent as — the settings' Format:
      HTML, or plain text (lines, sent as `text/plain` alone). */
  readonly bodyFormat = computed<BodyFormat>(() => this.message().format);
  readonly plainText = computed(() => this.bodyFormat() === 'text');

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
  onFormat(format: BodyFormat): void {
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

  /** The editor's appearance, the settings' toggle: a light or dark of its
      own, apart from the app's theme — or `auto`, the app's, following its
      top-bar toggle. Auto by default: the message sits in the app as the
      rest of it does; Light shows it as it is sent. A {@link Preferences}
      one: the same in every composer, and kept by this browser. */
  readonly editorAppearance = this.#preferences.editorAppearance;

  /** The attachment strip's rows — its corner toggle: one line, or two —
      the same in every composer, kept by this browser. */
  readonly attachmentRows = this.#preferences.attachmentRows;

  /** Two rows in reading order: the chips' first half on top, the rest
      under it, each column as wide as its wider chip. */
  readonly attachmentColumns = computed(() => Math.ceil(this.attachmentCount() / 2));

  /** How many attachments the message carries — the toggle's face and the
      strip's count. */
  readonly attachmentCount = computed(() => this.envelope.attachments().value().length);

  /** The strip is put away: its chips out of sight, so the text has the
      room, and the toggle beside Attach carries the count instead. This
      message's alone, not a preference: open on a wide screen, put away on
      the phone (`MobileMessageForm`), where the text needs every line. A
      new attachment brings the strip back (`attach`). */
  readonly attachmentsHidden = signal(false);

  /** What the strip's height runs across: its rows, and put away or not. */
  readonly attachmentStripLook = computed(() =>
    this.attachmentsHidden() ? 'hidden' : this.attachmentRows(),
  );

  /** Some attachment is still uploading — the toggle's count pulses while
      the strip is away, so a Send that waits is never a mystery. */
  readonly attachmentsBusy = computed(() =>
    this.message().attachments.some((attachment) => attachment.id === null),
  );

  /** Uploads still run while the strip is away: the toggle's count pulses,
      the strip's own progress being out of sight. */
  readonly attachmentToggleBusy = computed(() => this.attachmentsHidden() && this.attachmentsBusy());

  /** The writer bar — and the toggle on it — heads the sheet: the phone's
      always, the desktop's when mirrored. */
  protected abstract readonly barAtTop: Signal<boolean>;

  /** Where the bar's tooltips open: away from the sheet's edge the bar
      sits on — up from a bar at the foot, down from one on top. */
  readonly barTooltipPosition = computed<TooltipPosition>(() =>
    this.barAtTop() ? 'below' : 'above',
  );

  /** The toggle's chevron while the strip shows: toward the bar, where the
      chips go — down with the bar at the foot, up with it on top. Put away,
      the stylesheet turns it round, toward where they come back. */
  readonly attachmentChevron = computed(() => (this.barAtTop() ? 'expand_less' : 'expand_more'));

  /** The strip's id, for the toggle's `aria-controls`. */
  readonly attachmentStripId = `attachment-strip-${nextSheetId++}`;

  /** The count on the toggle's face: the number, up to nine — past it,
      9+ (the half is an icon's width). */
  readonly attachmentCountShort = computed(() => {
    const count = this.attachmentCount();
    return count > 9 ? '9+' : String(count);
  });

  /** What the toggle's face shows: the count while the strip is away —
      what is out of sight — and the plain chevron otherwise, as any
      toggle's (nothing attached included). */
  readonly attachmentToggleFace = computed(() =>
    this.attachmentsHidden() && this.attachmentCount() > 0 ? 'count' : 'chevron',
  );

  /** The toggle's name: what it shows and hides — the same either way;
      `aria-expanded` says which. */
  readonly attachmentToggleLabel = computed(() => {
    const count = this.attachmentCount();
    return this.i18n.t(`composer.attachments.count.${count === 1 ? 'one' : 'other'}`, { count });
  });

  /** The toggle's tooltip: what a press does now. */
  readonly attachmentToggleHint = computed(() =>
    this.i18n.t(this.attachmentsHidden() ? 'composer.attachments.show' : 'composer.attachments.hide'),
  );

  /** The toggle beside Attach: the strip put away, or back. It stays where
      it is either way, so focus does too. */
  toggleAttachments(): void {
    this.attachmentsHidden.update((hidden) => !hidden);
  }

  /** The strip's trash: every attachment out of the message, its transfer
      stopped — what a chip's own × does, all at once. No confirmation, as
      Discard has none. The strip goes with them: focus that was in it moves
      to the text, never to the page, and a screen reader hears what
      happened (the chips leave without a word of their own). */
  removeAttachments(): void {
    const attachments = this.message().attachments;
    if (!attachments.length) return;
    const inStrip = !!(document.activeElement as HTMLElement | null)?.closest('.attachment-strip');
    for (const attachment of attachments) this.uploads.cancel(attachment.key);
    this.message.update((m) => ({ ...m, attachments: [] }));
    void this.#announcer.announce(this.i18n.t('composer.attachments.removed'));
    if (inStrip) {
      afterNextRender({ write: () => this.emailPane().focus() }, { injector: this.#injector });
    }
  }

  /** A chip's download, faked: the demo's store holds no bytes, so it only
      says what a real host would start — the file is never fetched. */
  downloadAttachment(attachment: AttachmentRef): void {
    this.#snackBar.open(
      this.i18n.t('composer.attachments.downloading', { name: attachment.name }),
      undefined,
      { duration: 3000 },
    );
  }

  /** A chip's own click, faked: a real host would open a preview — this
      only says the click arrived. */
  attachmentClicked(attachment: AttachmentRef): void {
    this.#snackBar.open(
      this.i18n.t('composer.attachments.clicked', { name: attachment.name }),
      undefined,
      { duration: 3000 },
    );
  }

  /** The strip's corner toggle: one row to two and back. */
  toggleAttachmentRows(): void {
    this.attachmentRows.update((rows) => (rows === 'two' ? 'one' : 'two'));
  }

  /** Whether the sheet's formatting toolbar can be switched off — the
      writer bar's formatting button, and the settings' Formatting toolbar
      with it. A phone's sheet keeps its toolbar always there. */
  readonly toolbarSwitch: boolean = false;

  /** The scheme the editor draws in: the appearance, with `auto` read as
      the app's theme of the moment. Public for the frame, which makes the
      whole message wear it (a `PaperIsland`). */
  readonly editorScheme = computed<EditorColorScheme>(() => {
    const appearance = this.editorAppearance();
    return appearance === 'auto' ? this.#theme.scheme() : appearance;
  });

  /** The settings' View row — the editor or its HTML — where the frame has
      a source pane and the message is HTML. */
  readonly viewOffered = computed(() => this.sourceViews() && !this.plainText());

  /** The View toggle's pick: the HTML in the editor's place (code view), or
      the editor — the docked source beside it included. */
  readonly editorView = computed<EditorView>(() =>
    this.sourceView() === 'code' ? 'html' : 'editor',
  );

  /** The settings' Layout switch: whether the layout blocks — sections,
      columns, layout tables — take their gestures: a section's menu, the
      columns' drags and pills, a layout table's grips, drags, pills and
      menus. A bordered or borderless table is content, and keeps its own. Off, every
      block stands as laid out and its words still edit: a template whose
      layout is settled, filled in. The mode's default — on to design, off
      to write — until the switch is flipped for the message; a new mode
      starts it over. */
  readonly layoutInteractive = linkedSignal(() => this.mode() === 'design');

  /** The switch, as the editor takes it: every layout block alike. */
  readonly layoutInteraction = computed<LayoutInteractivity>(() => {
    const on = this.layoutInteractive();
    return { section: on, columns: on, table: on };
  });

  /** The View toggle: moves the source into the editor's place or out of
      it (from the docked view too, as the old </> did) — nothing for the
      view already in effect. */
  onEditorView(view: EditorView): void {
    if (view === this.editorView()) return;
    releaseEditingSurface();
    this.sourceView.set(view === 'html' ? 'code' : 'hidden');
  }

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
    this.rows().focus();
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
    this.rows().reset();
    this.cleared.emit();
    // A new message starts at To, whatever the sheet first opened on.
    afterNextRender({ write: () => this.focus() }, { injector: this.#injector });
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
    // What was just added is seen land: a strip put away comes back.
    this.attachmentsHidden.set(false);
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
