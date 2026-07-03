import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { EmailCompose } from './email-compose/email-compose';
import { HtmlEmailCompose } from './html-email-compose/html-email-compose';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-compose',
  imports: [EmailCompose, HtmlEmailCompose],
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
}
