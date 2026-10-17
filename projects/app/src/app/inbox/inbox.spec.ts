import { TestBed } from '@angular/core/testing';

import { ComposeWindows } from '../../services/compose-windows';
import { Inbox } from './inbox';
import { INBOX } from './mails';

describe('Inbox', () => {
  let opened: Parameters<ComposeWindows['open']>[0][];
  let root: HTMLElement;

  const button = (name: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().endsWith(name),
    )!;

  beforeEach(async () => {
    opened = [];
    await TestBed.configureTestingModule({
      imports: [Inbox],
      providers: [
        {
          provide: ComposeWindows,
          useValue: { open: async (options: (typeof opened)[number]) => opened.push(options) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Inbox);
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
  });

  it('lists the inbox and opens the newest message', () => {
    expect(root.querySelectorAll('.inbox-row')).toHaveLength(INBOX.length);
    expect(root.querySelector('.inbox-reader__subject')?.textContent).toBe(INBOX[0].subject);
  });

  it('Reply opens a window with its rows and history filled, the caret in the editor', () => {
    button('Reply').click();
    const [options] = opened;
    expect(options?.focus).toBe('body');
    expect(options?.content?.message.to).toEqual(['Ada Lovelace <ada@example.com>']);
    expect(options?.content?.message.subject).toBe('Re: Launch checklist for Thursday');
    expect(options?.content?.message.quoted).toContain('Before Thursday');
  });

  it('Reply all copies everyone else on the message', () => {
    button('Reply all').click();
    expect(opened[0]?.content?.message.cc).toEqual(['Charles Babbage <charles@example.com>']);
  });

  it('Forward has nobody to go to yet: the caret starts in To', () => {
    button('Forward').click();
    const [options] = opened;
    expect(options?.focus).toBe('to');
    expect(options?.content?.message.to).toEqual([]);
    expect(options?.content?.message.subject).toBe('Fwd: Launch checklist for Thursday');
  });
});
