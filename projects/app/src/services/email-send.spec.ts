import { TestBed } from '@angular/core/testing';
import { EMAIL_SEND_LATENCY, EmailMessage, EmailSend, SendRejected } from './email-send';

const message = (to: string[]): EmailMessage => ({
  from: ['me@example.com'],
  to,
  cc: [],
  bcc: [],
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: 'Hi',
  inlineImages: [],
  requiredFields: [],
  attachments: [],
});

describe('EmailSend', () => {
  let service: EmailSend;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: EMAIL_SEND_LATENCY, useValue: 0 }],
    });
    service = TestBed.inject(EmailSend);
  });

  it('accepts a message into the outbox and answers with a receipt', async () => {
    const receipt = await service.send(message(['ada@example.com']));
    expect(receipt.id).toBe('msg_1');
    expect(receipt.at).toBeInstanceOf(Date);
    expect(receipt.message.to).toEqual(['ada@example.com']);
    expect(service.outbox()).toEqual([receipt]);
    expect(service.last()).toBe(receipt);
  });

  it('rejects a bouncing recipient, naming the address, and keeps it out of the outbox', async () => {
    const attempt = service.send(message(['ada@example.com', 'Bob <bounce@example.com>']));
    await expect(attempt).rejects.toBeInstanceOf(SendRejected);
    await expect(attempt).rejects.toMatchObject({ address: 'Bob <bounce@example.com>' });
    expect(service.outbox()).toEqual([]);
  });
});
