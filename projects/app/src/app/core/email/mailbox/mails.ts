import type { InboundMessage } from '@h-k-dev/angular-email-editor';

/** A message in the demo inbox: what the library's reply seeds read
    (`InboundMessage`), plus what a list row shows. */
export interface InboxMail extends InboundMessage {
  readonly id: string;
  /** The sender's name for the list, without the address. */
  readonly name: string;
  readonly subject: string;
  readonly html: string;
  readonly date: Date;
  readonly unread?: boolean;
}

/** Days before now, at a given hour — dates that stay recent whenever the
    demo is opened. */
function daysAgo(days: number, hour: number, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

/** The demo inbox, newest first. Made up — people, companies and numbers. */
export const INBOX: readonly InboxMail[] = [
  {
    id: 'launch',
    name: 'Ada Lovelace',
    from: 'Ada Lovelace <ada@example.com>',
    to: 'you@example.com',
    cc: 'Charles Babbage <charles@example.com>',
    subject: 'Launch checklist for Thursday',
    date: daysAgo(0, 9, 42),
    unread: true,
    html:
      '<p>Hi,</p>' +
      '<p>Before Thursday’s launch, could you confirm three things?</p>' +
      '<ul><li>The pricing page shows the yearly toggle</li>' +
      '<li>The welcome email is approved</li>' +
      '<li>Support has the FAQ</li></ul>' +
      '<p>Thanks!<br>Ada</p>',
  },
  {
    id: 'invoice',
    name: 'Northwind Billing',
    from: 'Northwind Billing <billing@northwind.example>',
    replyTo: 'accounts@northwind.example',
    to: 'you@example.com',
    subject: 'Invoice NW-2041 is ready',
    date: daysAgo(1, 16, 5),
    unread: true,
    html:
      '<p>Hello,</p>' +
      '<p>Your invoice <strong>NW-2041</strong> for October is ready. ' +
      'The amount of €1,240.00 is due in 14 days.</p>' +
      '<p>Replies to this message reach our accounts team.</p>' +
      '<p>Northwind Billing</p>',
  },
  {
    id: 'offsite',
    name: 'Grace Hopper',
    from: 'Grace Hopper <grace@example.com>',
    to: 'you@example.com, Alan Turing <alan@example.com>',
    subject: 'Re: Offsite agenda',
    date: daysAgo(2, 11, 30),
    html:
      '<p>Works for me. I’d move the retro to the morning, when people still have energy.</p>' +
      '<p>Can you send the updated agenda to everyone by Friday?</p>' +
      '<p>— Grace</p>',
  },
  {
    id: 'review',
    name: 'Alan Turing',
    from: 'Alan Turing <alan@example.com>',
    to: 'you@example.com',
    subject: 'Quick review of the onboarding copy?',
    date: daysAgo(4, 14, 12),
    html:
      '<p>Hey,</p>' +
      '<p>I rewrote the first three onboarding emails. They’re shorter now, ' +
      'and each has one call to action. Would you have ten minutes to read them?</p>' +
      '<p>Alan</p>',
  },
];
