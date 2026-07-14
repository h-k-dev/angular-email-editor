import { ChangeDetectionStrategy, Component, computed, signal, viewChild } from '@angular/core';
import { HtmlDiagnostic, emailSizeBudget } from 'angular-email-editor';
import { EmailCompose } from './email-compose/email-compose';
import { HtmlEmailCompose } from './html-email-compose/html-email-compose';
import { EmailPreview } from './email-preview/email-preview';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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
}
