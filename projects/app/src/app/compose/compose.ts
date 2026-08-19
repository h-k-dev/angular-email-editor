import { Component, computed, signal, viewChild } from '@angular/core';
import { HtmlDiagnostic, SendIntent, emailSizeBudget, replyDocument } from 'angular-email-editor';
import { EmailCompose } from './email-compose/email-compose';
import { HtmlEmailCompose } from './html-email-compose/html-email-compose';
import { EmailPreview } from './email-preview/email-preview';
import { REPLY_EXAMPLES } from '../../../test/reply-examples';

@Component({
  selector: 'app-compose',
  imports: [EmailCompose, HtmlEmailCompose, EmailPreview],
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

  /** Demo stand-in for a transport: the example app has nowhere to send to,
      so the footer shows what a real host would hand its mailer. */
  protected lastSend = signal<string | null>(null);

  protected onSend(intent: SendIntent): void {
    const kb = (new TextEncoder().encode(intent.html).length / 1024).toFixed(1);
    this.lastSend.set(`Send intent · ${kb} kB HTML · ${intent.text.length} chars text`);
  }

  /** Demo-only: cycles the composer through reply seeds built from the dummy
      inbound messages in `test/reply-examples` — replaces the document via the
      same canonical `html` signal a real host would set. */
  protected exampleIndex = signal(-1);
  protected exampleLabel = computed(() => {
    const index = this.exampleIndex();
    if (index < 0) return 'Reply example';
    return `Reply ${index + 1}/${REPLY_EXAMPLES.length} — ${REPLY_EXAMPLES[index].name}`;
  });

  protected nextReplyExample(): void {
    const next = (this.exampleIndex() + 1) % REPLY_EXAMPLES.length;
    this.exampleIndex.set(next);
    this.html.set(replyDocument(REPLY_EXAMPLES[next].inbound));
  }
}
