import {
  Component,
  ElementRef,
  Injector,

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
import { MatIcon } from '@angular/material/icon';

// Angular File Drop
import { AngularFileDrop, FileDropEvent } from '@h-k-dev/angular-file-drop';

// Angular Email Editor
import {
  Editor,
  InlineImages,
  emailDocument,
  importLoss,
  importedDocument,
  toInboundMessage,
} from 'angular-email-editor';
import { isEmailAddress, parseMailbox } from 'angular-email-editor/address-chip';
import { AddressInput, addressList } from 'angular-email-editor/address-input';
import {
  Attachment,
  AttachmentChip,
  AttachmentChipIcon,
  AttachmentKind,
} from 'angular-email-editor/attachment-chip';
import { AttachmentChips } from 'angular-email-editor/attachment-chips';
import { KeepFocus } from 'angular-email-editor/focus';

import { DropHint } from '../drop-hint/drop-hint';
import { EmailCompose, SourceView } from '../email-compose/email-compose';
import { EmailWriter } from '../email-writer/email-writer';
import { Viewport } from '../../../services/viewport';
import { AttachmentUploads } from '../../../services/attachment-uploads';
import { EmailSend, SendRejected } from '../../../services/email-send';
import { BLANK, Envelope, hasContent, isBlank } from './envelope';

/** Tells the sheets on one page apart: every sheet's Subject input needs an
    id of its own for its label. */
let nextSheetId = 0;

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
    // Form
    FormField,
    FormRoot,

    // Components
    EmailWriter,
    EmailCompose,
    AddressInput,
    AttachmentChips,
    AttachmentChip,
    AttachmentChipIcon,
    MatIcon,
    MatIconButton,
    DropHint,
    AngularFileDrop,
    KeepFocus,
  ],
  templateUrl: './message-form.html',
  styleUrl: './message-form.scss',
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
  readonly #images = inject(InlineImages);
  readonly #injector = inject(Injector);
  protected readonly viewport = inject(Viewport);

  /** The Subject input's id, unique on the page. */
  protected readonly subjectId = `message-subject-${nextSheetId}`;
  /** The Preview text input's id, unique on the page. */
  protected readonly previewId = `message-preview-${nextSheetId++}`;

  /** The message — one model, owned here as a real host would own it
      (seeded from an account, a reply's headers, a draft). Every row on the
      sheet binds to a field of it through the form below. Writable from
      outside: a draft keeper seeds it, a frame may prefill it. */
  readonly message = signal<Envelope>(BLANK);

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

  /** Where the frame shows the HTML source; the editor steps out of code
      view by writing it. */
  readonly sourceView = model<SourceView>('hidden');

  /** The frame's code-view portal and the source editor inside it, when the
      frame has a source pane. */
  readonly codePortal = input<Portal<unknown> | null>(null);
  readonly codeEditor = input<Editor | undefined>();

  /** A send went through — the receipt, as the page's status strip words
      it. The sheet has started over by then. */
  readonly sent = output<string>();

  /** The bar's Discard was pressed. The sheet has started over by then. */
  readonly discarded = output<void>();

  /** The sheet started over — after a send or a discard. */
  readonly cleared = output<void>();

  /** Whether the formatting toolbar is switched on (the writer bar's
      formatting options button). Shown by default. */
  protected readonly formattingOpen = signal(true);

  /** Whether the composer's formatting toolbar shows. Always on a phone:
      there it is the bar on the keyboard, and the bar has no switch for it.
      A choice made on a wide screen is kept for when the screen is wide
      again. */
  protected readonly toolbarShown = computed(
    () => this.viewport.compact() || this.formattingOpen(),
  );

  readonly emailPane = viewChild.required(EmailCompose);

  /** The copy rows, for putting the caret in one the moment it opens. They
      exist only while shown. */
  protected readonly ccField = viewChild<AddressInput>('ccField');
  protected readonly bccField = viewChild<AddressInput>('bccField');

  /** The To row: where a message starts, so the caret lands there on
      arrival. */
  protected readonly toField = viewChild.required<AddressInput>('toField');

  constructor() {
    // Focus is a DOM write: the write phase, batched ahead of the reads of
    // the same pass (the toolbar measuring itself).
    afterNextRender({ write: () => this.focus() });
  }

  /** Puts the caret in To, where a message starts. */
  focus(): void {
    this.toField().focus();
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
    afterNextRender({ write: () => this.focus() }, { injector: this.#injector });
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
    () => this.previewOpen() || this.message().previewText.length > 0,
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
    const { from, to, cc, bcc, subject, previewText, attachments } = field().value();
    try {
      const receipt = await this.#transport.send({
        ...intent,
        // No `lang`: the app's language is the reader's UI, not the
        // message's — the article's `dir="auto"` still reads the text.
        document: emailDocument(intent.html, { title: subject, previewText }),
        from,
        to,
        cc,
        bcc,
        subject,
        attachments,
      });
      const kb = (new TextEncoder().encode(intent.html).length / 1024).toFixed(1);
      const parts = intent.inlineImages.length;
      const note =
        `Sent ${receipt.id} · to ${to.length} recipient${to.length === 1 ? '' : 's'}` +
        (subject ? ` · “${subject}”` : ' · no subject') +
        (previewText ? ' · preview text' : '') +
        ` · ${kb} kB HTML · ${intent.text.length} chars text` +
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
