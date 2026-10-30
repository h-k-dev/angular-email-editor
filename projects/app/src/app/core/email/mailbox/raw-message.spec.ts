import { looksLikeRawMessage } from './raw-message';

describe('looksLikeRawMessage', () => {
  it('knows a message as it travels: header fields, folded lines, a blank line, the body', () => {
    const raw = [
      'Delivered-To: you@example.com',
      'Received: by 2002:a05:7300 with SMTP id p18csp;',
      '        Fri, 30 Oct 2026 13:41:30 -0700 (PDT)',
      'MIME-Version: 1.0',
      'From: Google <noreply-accounts@google.com>',
      'Content-Type: text/plain',
      '',
      'Hello',
    ].join('\r\n');
    expect(looksLikeRawMessage(raw)).toBe(true);
  });

  it('takes no prose with a colon in it for one', () => {
    expect(looksLikeRawMessage('Note: buy milk\nTodo: call Jane\n\nThanks')).toBe(false);
    expect(looksLikeRawMessage('From: Jane\n\nHi')).toBe(false);
    expect(looksLikeRawMessage('Hello there\nFrom: Jane\nMIME-Version: 1.0\n\nHi')).toBe(false);
    expect(looksLikeRawMessage('')).toBe(false);
  });
});
