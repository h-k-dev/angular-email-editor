import { TestBed } from '@angular/core/testing';

import { provideExampleMail } from '../../../../../test/received-mail-fixture';
import { ReceivedMail } from './received-mail';

describe('ReceivedMail', () => {
  let mail: ReceivedMail;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideExampleMail()] });
    mail = TestBed.inject(ReceivedMail);
    await vi.waitFor(() => expect(mail.settled()).toBe(true));
  });

  it('is the catalogue’s received mail, in its order: the inbound messages, then the newsletters', () => {
    expect(mail.mails().map((m) => m.id)).toEqual([
      'reply-plain-note',
      'reply-text-only',
      'mjml-austin',
    ]);
  });

  it('reads an inbound message as it came: its sender, its date as written, its name as subject', () => {
    const [note] = mail.mails();
    expect(note.name).toBe('Jane Doe');
    expect(note.from).toBe('Jane Doe <jane@example.com>');
    expect(note.date).toBe('Aug 18, 2026, 4:32 PM');
    expect(note.subject).toBe('Plain note');
    expect(note.to).toBe('you@example.com');
    expect(note.html).toContain('Are we still on');
  });

  it('turns a text-only message into lines to read', () => {
    const text = mail.mails()[1];
    expect(text.name).toBe('ops@example.com');
    expect(text.html).toContain('<div>Server maintenance tonight 23:00-01:00.</div>');
    expect(text.date).toBeUndefined();
  });

  it('reads a newsletter from the sender its name says, its subject the document’s title', () => {
    const austin = mail.mails()[2];
    expect(austin.name).toBe('Austin');
    expect(austin.from).toBe('Austin <austin@example.com>');
    expect(austin.subject).toBe('Discount Light');
    expect(austin.html).toContain('<title>Discount Light</title>');
  });

  it('keeps every message unread until it is opened', () => {
    expect(mail.unread().size).toBe(3);
    mail.read('mjml-austin');
    expect(mail.unread().has('mjml-austin')).toBe(false);
    expect(mail.unread().size).toBe(2);
  });
});
