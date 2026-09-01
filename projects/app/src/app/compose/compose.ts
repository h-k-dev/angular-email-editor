import { Component, computed, signal, viewChild } from '@angular/core';
import { OverlayModule } from '@angular/cdk/overlay';
import { AngularFileDrop, FileDropEvent } from '@h-k-dev/angular-file-drop';
import {
  HtmlDiagnostic,
  SendIntent,
  emailSizeBudget,
  importLoss,
  importedDocument,
  replyDocument,
  toInboundMessage,
} from 'angular-email-editor';
import { EmailCompose } from './email-compose/email-compose';
import { HtmlEmailCompose } from './html-email-compose/html-email-compose';
import { EmailPreview } from './email-preview/email-preview';
import { REPLY_EXAMPLES } from '../../../test/reply-examples';
import {
  ANGULAR_EXPRESSION_EXAMPLES,
  HANDLEBARS_EXAMPLES,
} from '../../../test/template-examples';

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
  imports: [EmailCompose, HtmlEmailCompose, EmailPreview, AngularFileDrop, OverlayModule],
  templateUrl: './compose.html',
  styleUrl: './compose.scss',
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

  protected sourcePane = viewChild.required(HtmlEmailCompose);
  protected emailPane = viewChild.required(EmailCompose);

  /** Live word/line counter, measured mathematically by the email pane. */
  protected metrics = computed(() => this.emailPane().bodyMetrics());

  protected errors = computed(
    () => this.diagnostics().filter((d) => d.severity === 'error').length,
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

  /** Jumps the source pane to the first diagnostic of the given severity. */
  protected reveal(severity: 'error' | 'warning'): void {
    const diagnostic = this.diagnostics().find((d) => d.severity === severity);
    if (diagnostic) this.sourcePane().reveal(diagnostic);
  }

  /** A dropped .eml imports as the document. MIME parsing is postal-mime's
      job (bring-your-own-parser is the library's stance — `toInboundMessage`
      is the whole bridge); lazy-imported so the parser costs nothing until
      the first drop. A File is a Blob, so it goes to the parser as raw bytes
      (correct charsets, no lossy .text() step). */
  protected importNote = signal<string | null>(null);

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
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.html.set(importedDocument(inbound));

      // Legibility of loss: say what the import dropped instead of losing it
      // silently — schema-side loss from the library, MIME-side from the parser.
      const loss = importLoss(inbound);
      const attachments = parsed.attachments?.length ?? 0;
      const notes = [
        `Imported ${dropped.name}${inbound.subject ? ` — “${inbound.subject}”` : ''}`,
      ];
      if (loss.removedElements) {
        notes.push(
          `${loss.removedElements} element${loss.removedElements === 1 ? '' : 's'} outside the ` +
            `schema removed (${loss.removedTags.slice(0, 3).join(', ')})`,
        );
      }
      if (loss.inlineImages) {
        notes.push(
          `${loss.inlineImages} inline image${loss.inlineImages === 1 ? ' awaits' : 's await'} attachments`,
        );
      }
      if (attachments) {
        notes.push(`${attachments} attachment${attachments === 1 ? '' : 's'} ignored`);
      }
      this.importNote.set(notes.join(' · '));
    } catch {
      this.importNote.set(`Couldn't read ${dropped.name} as an email`);
    }
  }

  /** Demo stand-in for a transport: the example app has nowhere to send to,
      so the footer shows what a real host would hand its mailer. */
  protected lastSend = signal<string | null>(null);

  protected onSend(intent: SendIntent): void {
    const kb = (new TextEncoder().encode(intent.html).length / 1024).toFixed(1);
    this.lastSend.set(`Send intent · ${kb} kB HTML · ${intent.text.length} chars text`);
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
  protected exampleSetOptions = (
    ['reply', 'angular', 'handlebars'] as const
  ).map((key) => ({ key, label: this.#exampleSets[key].label }));

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
