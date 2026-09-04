import { Component, contentChild, effect, model, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { SendIntent } from 'angular-email-editor';

import { AddressInput } from '../address-input/address-input';
import { EmailCompose } from '../email-compose/email-compose';

/** What the writer hands the host on Send: the envelope it collected plus
    the editor's send intent (the body, its text projection, inline parts,
    required fields). Transport stays the host's. */
export interface EmailMessage extends SendIntent {
  from: string[];
  to: string[];
  subject: string;
}

/**
 * The email writer: the frame an editor is written in. Send on top, the
 * envelope fields under it — From, To, Subject, Gmail-style rows — and the
 * editor projected below. The writer owns the envelope and the act of
 * sending; the editor owns the payload (its send-intent extension builds it);
 * the host owns what happens next (`(send)`).
 */
@Component({
  selector: 'section[email-writer]',
  imports: [MatButtonModule, MatIconModule, AddressInput],
  templateUrl: './email-writer.html',
  styleUrl: './email-writer.scss',
})
export class EmailWriter {
  /** The envelope, two-way bound so the host can seed and read it. */
  from = model<string[]>([]);
  to = model<string[]>([]);
  subject = model('');

  /** The message, whenever a send is asked for — the Send button, or the
      editor's own ways in (/send, Mod-Enter): every path ends here. */
  send = output<EmailMessage>();

  /** The editor written in — projected, so the host keeps its bindings. */
  readonly editor = contentChild(EmailCompose);

  constructor() {
    // Relay the editor's intent as the whole message. The editor's output is
    // subscribed for as long as that editor is the projected one.
    effect((onCleanup) => {
      const editor = this.editor();
      if (!editor) return;
      const subscription = editor.send.subscribe((intent) =>
        this.send.emit({ ...intent, from: this.from(), to: this.to(), subject: this.subject() }),
      );
      onCleanup(() => subscription.unsubscribe());
    });
  }

  /** Asks the editor for its send intent; the relay above turns it into
      the message. */
  requestSend(): void {
    this.editor()?.requestSend();
  }
}
