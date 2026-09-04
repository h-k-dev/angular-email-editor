import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { OverlayModule } from '@angular/cdk/overlay';
import { DomPortal } from '@angular/cdk/portal';
import { AngularFileDrop, FileDropEvent } from '@h-k-dev/angular-file-drop';
import {
  HtmlDiagnostic,
  emailSizeBudget,
  InlineImages,
  importLoss,
  importedDocument,
  replyDocument,
  toInboundMessage,
} from 'angular-email-editor';
import { EmailCompose, SourceView } from './email-compose/email-compose';
import { EmailMessage, EmailWriter } from './email-writer/email-writer';
import { Viewport } from '../viewport';

/** A status-strip note and the document it is about. */
interface StatusNote {
  text: string;
  html: string;
}
import { HtmlEmailCompose } from './html-email-compose/html-email-compose';
import { EmailPreview } from './email-preview/email-preview';
import { REPLY_EXAMPLES } from '../../../test/reply-examples';
import { ANGULAR_EXPRESSION_EXAMPLES, HANDLEBARS_EXAMPLES } from '../../../test/template-examples';

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
    EmailWriter,
    EmailCompose,
    HtmlEmailCompose,
    EmailPreview,
    AngularFileDrop,
    OverlayModule,
  ],
  // One inline image registry per composer — the editor pane hands it to the
  // editor, the preview resolves from it, an import feeds it. Never in root.
  providers: [InlineImages],
  templateUrl: './compose.html',
  styleUrl: './compose.scss',
  host: {
    // State hooks: the preview docked left, the source docked right.
    '[class.compose--detached]': "sourceView() === 'detached'",
    '[class.compose--preview]': 'previewOpen()',
    // Below the docking breakpoint there are no flanks to keep.
    '[class.compose--narrow]': 'viewport.narrow()',
  },
})
export class Compose {
  /**
   * Canonical email HTML — the single signal both composers bind to.
   * The email composer publishes what its schema serializes; the HTML
   * composer publishes raw source, which the email composer parses and
   * canonicalizes back into this signal.
   */
  protected html = signal('');

  /** Lint results streamed up from the source pane's language service. */
  protected diagnostics = signal<HtmlDiagnostic[]>([]);

  /** The envelope, owned here as a real host would (seeded from an account,
      a reply's headers, a draft) — the writer edits it. */
  protected from = signal<string[]>(['you@example.com']);
  protected to = signal<string[]>([]);
  protected subject = signal('');

  /** Where the HTML source shows (the toolbar's </> and detach buttons).
      Owned here because revealing a finding has to switch to a view that can
      show it. */
  protected sourceView = signal<SourceView>('hidden');

  /** Whether the preview pane shows, docked to the left (the toolbar's
      preview button). Hidden by default, like the source. */
  protected previewOpen = signal(false);

  /** Below the docking breakpoint the composer shows one pane at a time: the
      dock-out buttons leave the toolbar, and a pane already docked beside the
      editor collapses. Code view is in place, so it stays. */
  protected readonly viewport = inject(Viewport);

  readonly #collapseOnNarrow = effect(() => {
    if (!this.viewport.narrow()) return;
    if (this.sourceView() === 'detached') this.sourceView.set('hidden');
    this.previewOpen.set(false);
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

  protected async onEmlDrop(event: FileDropEvent): Promise<void> {
    const dropped = event.files[0]?.file;
    if (!dropped) return;
    try {
      const { default: PostalMime } = await import('postal-mime');
      const parsed = await PostalMime.parse(dropped);
      const inbound = toInboundMessage(parsed);
      // A drop must import immediately: release editor focus first (the
      // pane's blur catch-up would apply it eventually anyway — this makes
      // "eventually" be "now").
      // The message's inline parts go into the registry *before* the document,
      // so every `cid:` resolves the moment its node view mounts.
      let inlineParts = 0;
      for (const part of parsed.attachments ?? []) {
        const cid = part.contentId?.replace(/^<|>$/g, '');
        if (!cid || !part.content) continue;
        this.#images.add(
          new Blob([part.content as BlobPart], {
            type: part.mimeType || 'application/octet-stream',
          }),
          cid,
        );
        inlineParts++;
      }
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
        notes.push(`${ignored} attachment${ignored === 1 ? '' : 's'} ignored`);
      }
      this.#importNote.set({ text: notes.join(' · '), html: this.html() });
    } catch {
      this.#importNote.set({
        text: `Couldn't read ${dropped.name} as an email`,
        html: this.html(),
      });
    }
  }

  /** Demo stand-in for a transport: the example app has nowhere to send to,
      so the footer shows what a real host would hand its mailer — envelope
      and body alike. */
  readonly #lastSend = signal<StatusNote | null>(null);
  protected lastSend = computed(() => this.#current(this.#lastSend()));

  protected onSend(message: EmailMessage): void {
    const kb = (new TextEncoder().encode(message.html).length / 1024).toFixed(1);
    const parts = message.inlineImages.length;
    const recipients = message.to.length;
    this.#lastSend.set({
      html: this.html(),
      text:
        `Send intent · to ${recipients} recipient${recipients === 1 ? '' : 's'}` +
        (message.subject ? ` · “${message.subject}”` : ' · no subject') +
        ` · ${kb} kB HTML · ${message.text.length} chars text` +
        (parts
          ? ` · ${parts} inline image${parts === 1 ? '' : 's'} as cid: part${parts === 1 ? '' : 's'}`
          : ''),
    });
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
