import { InjectionToken, Service, computed, inject, signal } from '@angular/core';
import { SendIntent } from 'angular-email-editor';
import { parseMailbox } from 'angular-email-editor/address-chip';
import { AttachmentRef } from './attachment-uploads';

/** What the transport is handed: the editor's send intent (body, its text
    projection, inline parts, required fields) plus the validated envelope
    and the attachment references. Bytes are the store's, by id. */
export interface EmailMessage extends SendIntent {
  readonly from: string[];
  readonly to: string[];
  readonly cc: string[];
  readonly bcc: string[];
  readonly subject: string;
  readonly attachments: AttachmentRef[];
}

export interface SendReceipt {
  readonly id: string;
  readonly at: Date;
  readonly message: EmailMessage;
}

/** The server would not take a recipient. Carries the address so the form
    can pin the error on the To row. */
export class SendRejected extends Error {
  constructor(readonly address: string) {
    super(`${address} was rejected by the mail server`);
    this.name = 'SendRejected';
  }
}

/** How long the mock takes to answer, in ms. Specs set it to 0. */
export const EMAIL_SEND_LATENCY = new InjectionToken<number>('EMAIL_SEND_LATENCY', {
  factory: () => 600,
});

/**
 * The transport, mocked. The example app has nowhere to send to, so this
 * stands in for whatever a host wires here — a backend endpoint, or a
 * provider's browser API. It behaves like one: it takes its time, it keeps
 * an outbox of what it accepted, and it rejects a recipient whose local
 * part is `bounce` (`bounce@example.com`), so the round trip from a server
 * error back onto the form can be exercised without a server.
 */
@Service()
export class EmailSend {
  readonly #latency = inject(EMAIL_SEND_LATENCY);
  #next = 0;

  /** Everything accepted so far, oldest first. */
  readonly outbox = signal<readonly SendReceipt[]>([]);
  readonly last = computed(() => this.outbox().at(-1) ?? null);

  async send(message: EmailMessage): Promise<SendReceipt> {
    await new Promise((resolve) => setTimeout(resolve, this.#latency));
    const bounced = [...message.to, ...message.cc, ...message.bcc].find((mailbox) =>
      parseMailbox(mailbox).address.toLowerCase().startsWith('bounce@'),
    );
    if (bounced) throw new SendRejected(bounced);
    const receipt: SendReceipt = { id: `msg_${++this.#next}`, at: new Date(), message };
    this.outbox.update((list) => [...list, receipt]);
    return receipt;
  }
}
