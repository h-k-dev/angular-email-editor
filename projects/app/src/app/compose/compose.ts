import {
  Component,
  ElementRef,
  Injector,

  // Singals
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';

// Angular CDK
import { OverlayModule } from '@angular/cdk/overlay';
import { DomPortal } from '@angular/cdk/portal';

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

// Angular File Drop
import { AngularFileDrop, FileDropEvent } from '@h-k-dev/angular-file-drop';

// Angular Email Editor
import {
  AddressInput,
  Attachment,
  AttachmentChip,
  AttachmentChipIcon,
  AttachmentChips,
  AttachmentKind,
  HtmlDiagnostic,
  InlineImages,
  addressList,
  emailSizeBudget,
  importLoss,
  importedDocument,
  isEmailAddress,
  parseMailbox,
  replyDocument,
  toInboundMessage,
} from 'angular-email-editor';
import { MatIcon } from '@angular/material/icon';
import { EmailCompose, SourceView } from './email-compose/email-compose';
import { DropHint } from './drop-hint/drop-hint';
import { EmailWriter } from './email-writer/email-writer';
import { Viewport } from '../viewport';
import { AttachmentRef, AttachmentUploads } from '../../services/attachment-uploads';
import { EmailSend, SendRejected } from '../../services/email-send';

/** A dropped file that is a message rather than an attachment. The MIME type
    is what a mail client sets; the extension is what survives a trip through
    a filesystem that never knew the type — either alone is enough. */
function isEml(file: File): boolean {
  return file.type === 'message/rfc822' || /\.eml$/i.test(file.name);
}

/** A status-strip note and the document it is about. */
interface StatusNote {
  text: string;
  html: string;
}
import { HtmlEmailCompose } from './html-email-compose/html-email-compose';
import { EmailPreview } from './email-preview/email-preview';
import { REPLY_EXAMPLES } from '../../../test/reply-examples';
import { ANGULAR_EXPRESSION_EXAMPLES, HANDLEBARS_EXAMPLES } from '../../../test/template-examples';

/**
 * The message as the form holds it: what the user controls, and nothing
 * derived. The text projection, the inline parts and the cid promotion are
 * the editor's to produce at send time (`EmailMessage`); the attachment
 * bytes are the store's, by id. Every row on the sheet is a field of this.
 */
export interface Envelope {
  from: string[];
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  attachments: AttachmentRef[];
}

/** Whether a body has anything to send: some text, or an image. An empty
    editor still serializes to a paragraph, so `required` cannot tell. */
function hasContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  return text.trim().length > 0;
}

type ExampleSetKey = 'reply' | 'angular' | 'handlebars';

interface ExampleSet {
  /** Menu entry / resting label of the split button. */
  label: string;
  /** Prefix of the cycling label ("Reply 2/4 — Gmail thread"). */
  short: string;
  examples: { name: string; html: () => string }[];
}

@Component({
  selector: 'app-compose',
  imports: [
    // Form
    FormField,
    FormRoot,

    // Angular CDK
    OverlayModule,

    // Components
    EmailWriter,
    EmailCompose,
    AddressInput,
    AttachmentChips,
    AttachmentChip,
    AttachmentChipIcon,
    MatIcon,
    DropHint,
    HtmlEmailCompose,
    EmailPreview,
    AngularFileDrop,
  ],
  // One inline image registry per composer — the editor pane hands it to the
  // editor, the preview resolves from it, an import feeds it. Never in root.
  providers: [InlineImages],
  templateUrl: './compose.html',
  styleUrl: './compose.scss',
  host: {
    '[class.compose--detached]': "sourceView() === 'detached'",
    '[class.compose--preview]': 'previewOpen()',
    '[class.compose--compact]': 'viewport.compact()',
  },
})
export class Compose {
  /** The upload store: the strip's chips read their progress from it, and a
      removed chip stops its transfer there. */
  protected readonly uploads = inject(AttachmentUploads);

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

  /** The message — one model, owned here as a real host would own it
      (seeded from an account, a reply's headers, a draft). Every row on the
      sheet binds to a field of it through the form below. */
  protected readonly message = signal<Envelope>({
    from: ['you@example.com'],
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    html: '',
    attachments: [],
  });

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
  protected readonly envelope = form(
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
   * the field's control); the HTML composer publishes raw source here, which
   * the email composer parses and canonicalizes back. A write lands in the
   * message, and reads come from it: the model is the one source of truth.
   */
  protected html = linkedSignal<string, string>({
    source: () => this.message().html,
    computation: (html) => html,
    set: (html) => this.message.update((m) => (m.html === html ? m : { ...m, html })),
  });

  /** Lint results streamed up from the source pane's language service. */
  protected diagnostics = signal<HtmlDiagnostic[]>([]);

  /** Below the docking breakpoint the composer shows one pane at a time: the
      dock-out buttons leave the toolbar, and a pane already docked beside the
      editor collapses. Code view is in place, so it stays. The two pane
      signals below are linked to the breakpoint for it: state that resets
      when its source changes, not an effect writing into a signal. */
  protected readonly viewport = inject(Viewport);

  /** Where the HTML source shows (the toolbar's </> and detach buttons).
      Owned here because revealing a finding has to switch to a view that can
      show it. Going narrow folds a detached pane back to hidden; going wide
      again leaves whatever the user has. */
  protected sourceView = linkedSignal({
    source: this.viewport.narrow,
    computation: (narrow, previous): SourceView => {
      const view = previous?.value ?? 'hidden';
      return narrow && view === 'detached' ? 'hidden' : view;
    },
  });

  /** Whether the preview pane shows, docked to the left (the toolbar's
      preview button). Hidden by default, like the source, and closed by the
      breakpoint going narrow. */
  protected previewOpen = linkedSignal({
    source: this.viewport.narrow,
    computation: (narrow, previous): boolean => !narrow && (previous?.value ?? false),
  });

  /** The source pane's element, for the code-view portal. */
  protected sourceEl = viewChild.required('sourceEl', { read: ElementRef });

  /** In code view the source pane's own DOM node moves into the composer's
      editing surface (a DomPortal: attached, the node moves in; detached, it
      returns to its column on the right). The editor inside is never
      re-created. */
  protected codePortal = computed(() =>
    this.sourceView() === 'code' ? new DomPortal(this.sourceEl()) : null,
  );

  readonly #injector = inject(Injector);
  protected sourcePane = viewChild.required(HtmlEmailCompose);
  protected emailPane = viewChild.required(EmailCompose);

  /** The copy rows, for putting the caret in one the moment it opens. They
      exist only while shown. */
  protected ccField = viewChild<AddressInput>('ccField');
  protected bccField = viewChild<AddressInput>('bccField');

  /** The To row: where a message starts, so the caret lands there on
      arrival. */
  protected toField = viewChild.required<AddressInput>('toField');

  constructor() {
    afterNextRender(() => this.toField().focus());
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
    afterNextRender(() => (which === 'cc' ? this.ccField() : this.bccField())?.focus(), {
      injector: this.#injector,
    });
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

  /** Focus left the recipients — To, Cc and Bcc together — for somewhere
      else: the rows merge into one line, and the empty copy rows fold.
      Moving between the three never does. */
  /** A press on a row anywhere but on a control — the label, the padding —
      leaves focus where it is; the row's click puts the caret in its
      control. Without this the press would take focus to the body for an
      instant, and an address row would drop from chips to text and back in
      a flash. */
  protected keepCaret(event: MouseEvent): void {
    if (!(event.target as Element).closest('input, button, textarea')) event.preventDefault();
  }

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
  protected metrics = computed(() => this.emailPane().bodyMetrics());

  /** Errors: the source pane's lint errors plus the body's expression
      syntax problems (the dialect the editor pane opts into). */
  protected errors = computed(
    () =>
      this.diagnostics().filter((d) => d.severity === 'error').length +
      this.emailPane().expressionDiagnostics().length,
  );

  protected warnings = computed(
    () => this.diagnostics().filter((d) => d.severity === 'warning').length,
  );

  /** The canonical HTML measured against Gmail's 102 KB clipping limit. */
  protected size = computed(() => emailSizeBudget(this.html()));
  protected sizeLabel = computed(
    () =>
      `${(this.size().bytes / 1024).toFixed(1)} kB of ${Math.round(this.size().limit / 1024)} kB`,
  );

  /** The form's first complaint, for the status strip — once the user has
      been through a row or has tried to send (the form is touched), never
      before: a sheet that shouts on arrival is not a sheet anyone writes on. */
  protected problem = computed(() => {
    const state = this.envelope();
    if (!state.touched() || !state.invalid()) return null;
    return state.errorSummary()[0]?.message ?? null;
  });

  /** Jumps to the first diagnostic of the given severity: the source pane
      for a lint finding, the editor pane for an expression problem. */
  protected reveal(severity: 'error' | 'warning'): void {
    const diagnostic = this.diagnostics().find((d) => d.severity === severity);
    if (diagnostic) {
      this.#inView(true, () => this.sourcePane().reveal(diagnostic));
      return;
    }
    const expression = this.emailPane().expressionDiagnostics()[0];
    if (severity === 'error' && expression) {
      this.#inView(false, () => this.emailPane().revealExpression(expression));
    }
  }

  /** Runs `show` with the pane it needs on screen — the source (either
      view of it) or the editor — switching first when it is not, and only
      after the switch has rendered: selecting and focusing inside a hidden
      surface is a no-op. A hidden source opens in code view; a source
      standing in the editor's place steps aside for it. */
  #inView(source: boolean, show: () => void): void {
    const view = this.sourceView();
    const visible = source ? view !== 'hidden' : view !== 'code';
    if (visible) {
      show();
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.sourceView.set(source ? 'code' : 'hidden');
    afterNextRender(show, { injector: this.#injector });
  }

  /** A dropped .eml imports as the document. MIME parsing is postal-mime's
      job (bring-your-own-parser is the library's stance — `toInboundMessage`
      is the whole bridge); lazy-imported so the parser costs nothing until
      the first drop. A File is a Blob, so it goes to the parser as raw bytes
      (correct charsets, no lossy .text() step). */
  readonly #images = inject(InlineImages);

  /** A status note describes *one* document: it is stamped with the html it
      was made for and shown only while that is still the document — a note
      outliving its document ("1 inline image as cid: part" after the image
      was deleted) is a status desync. */
  readonly #importNote = signal<StatusNote | null>(null);
  protected importNote = computed(() => this.#current(this.#importNote()));

  #current(note: StatusNote | null): string | null {
    return note && note.html === this.html() ? note.text : null;
  }

  /**
   * A file dropped on the editing surface is an attachment — including an
   * `.eml`, which there means "send this message along", not "open it".
   * Opening is the page's gesture, one zone out (`onEmlDrop`), and the page
   * is everything but the surface — the toolbar and the strip included.
   *
   * Only drops the editor did not claim arrive here: ProseMirror takes a
   * pure-image drop and embeds it inline, so images alone are content and
   * anything else — a PDF, or an image among other files — is an attachment.
   */
  protected onAttachmentDrop(event: FileDropEvent): void {
    const dropped = event.files.map(({ file }) => file);
    if (dropped.length) this.#attach(dropped);
  }

  /** Hands files to the store and keeps only their references — upload on
      drop, as a real host does. Each reference gets its id when its transfer
      settles; a chip removed before then has taken its reference with it,
      and the id has nowhere to land. */
  #attach(files: readonly Attachment[]): void {
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

  protected async onEmlDrop(event: FileDropEvent): Promise<void> {
    const dropped = event.files[0]?.file;
    if (dropped) await this.#importEml(dropped);
  }

  async #importEml(dropped: File): Promise<void> {
    try {
      const { default: PostalMime } = await import('postal-mime');
      const parsed = await PostalMime.parse(dropped);
      const inbound = toInboundMessage(parsed);
      // A drop must import immediately: release editor focus first (the
      // pane's blur catch-up would apply it eventually anyway — this makes
      // "eventually" be "now").
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
      this.#attach(attached);
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
      this.#importNote.set({ text: notes.join(' · '), html: this.html() });
    } catch {
      this.#importNote.set({
        text: `Couldn't read ${dropped.name} as an email`,
        html: this.html(),
      });
    }
  }

  /** The editor's own ways in — Mod-Enter, /send — submit the form exactly
      as the Send button does: one path, validated. */
  protected send(): void {
    void submit(this.envelope);
  }

  /** What the transport accepted, for the footer: the receipt, and what a
      real host would have handed its mailer — envelope and body alike. */
  readonly #lastSend = signal<StatusNote | null>(null);
  protected lastSend = computed(() => this.#current(this.#lastSend()));

  /** The submit action: the validated message goes to the transport. A
      rejection the server pins on an address comes back as an error on the
      To row — the round trip a real backend's answer takes. */
  async #deliver(field: FieldTree<Envelope>): Promise<TreeValidationResult> {
    const intent = this.emailPane().intent();
    if (!intent) return { kind: 'editor.unready', message: 'The editor is still loading' };
    const { from, to, cc, bcc, subject, attachments } = field().value();
    try {
      const receipt = await this.#transport.send({
        ...intent,
        from,
        to,
        cc,
        bcc,
        subject,
        attachments,
      });
      const kb = (new TextEncoder().encode(intent.html).length / 1024).toFixed(1);
      const parts = intent.inlineImages.length;
      this.#lastSend.set({
        html: this.html(),
        text:
          `Sent ${receipt.id} · to ${to.length} recipient${to.length === 1 ? '' : 's'}` +
          (subject ? ` · “${subject}”` : ' · no subject') +
          ` · ${kb} kB HTML · ${intent.text.length} chars text` +
          (parts
            ? ` · ${parts} inline image${parts === 1 ? '' : 's'} as cid: part${parts === 1 ? '' : 's'}`
            : '') +
          (attachments.length
            ? ` · ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
            : ''),
      });
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
      strip says what for (`problem`). An attachment still uploading has no
      control to focus — the note is the whole answer. */
  #revealInvalid(field: FieldTree<Envelope>): void {
    field().errorSummary()[0]?.fieldTree().focusBoundControl();
  }

  /** Demo-only example cycler, one set per scenario: reply seeds (the split
      button's default), AngularJS-expression templates (the iusta dialect)
      and Handlebars templates. The main button cycles the active set; the
      caret's dropdown switches sets and loads that set's next example. All
      of them replace the document via the same canonical `html` signal a
      real host would set. */
  #exampleSets: Record<ExampleSetKey, ExampleSet> = {
    reply: {
      label: 'Reply example',
      short: 'Reply',
      examples: REPLY_EXAMPLES.map((example) => ({
        name: example.name,
        html: () => replyDocument(example.inbound),
      })),
    },
    angular: {
      label: 'AngularJS expression example',
      short: 'AngularJS',
      examples: ANGULAR_EXPRESSION_EXAMPLES.map((example) => ({
        name: example.name,
        html: () => example.html,
      })),
    },
    handlebars: {
      label: 'Handlebars example',
      short: 'Handlebars',
      examples: HANDLEBARS_EXAMPLES.map((example) => ({
        name: example.name,
        html: () => example.html,
      })),
    },
  };

  /** Dropdown rows, in the order they should read. */
  protected exampleSetOptions = (['reply', 'angular', 'handlebars'] as const).map((key) => ({
    key,
    label: this.#exampleSets[key].label,
  }));

  protected exampleMenuOpen = signal(false);
  /** The active set and its position; -1 = nothing loaded yet. Each set
      remembers its own position, so switching back resumes the cycle. */
  protected exampleState = signal<{ set: ExampleSetKey; index: number }>({
    set: 'reply',
    index: -1,
  });
  #exampleIndices: Record<ExampleSetKey, number> = { reply: -1, angular: -1, handlebars: -1 };

  protected exampleLabel = computed(() => {
    const { set, index } = this.exampleState();
    const s = this.#exampleSets[set];
    if (index < 0) return s.label;
    return `${s.short} ${index + 1}/${s.examples.length} — ${s.examples[index].name}`;
  });

  protected nextExample(set?: ExampleSetKey): void {
    this.exampleMenuOpen.set(false);
    const key = set ?? this.exampleState().set;
    const examples = this.#exampleSets[key].examples;
    const index = (this.#exampleIndices[key] + 1) % examples.length;
    this.#exampleIndices[key] = index;
    this.exampleState.set({ set: key, index });
    this.html.set(examples[index].html());
  }
}
