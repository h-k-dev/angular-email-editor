import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposeWindows } from '../../../../../core/email/compose-windows';
import { INBOX } from '../../../../../core/email/mailbox/mails';
import { Preferences } from '../../../../../core/storages/preferences';
import { InboxReader } from './inbox-reader';

describe('InboxReader', () => {
  let fixture: ComponentFixture<InboxReader>;
  let root: HTMLElement;
  let opened: Parameters<ComposeWindows['open']>[0][];

  const button = (name: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().endsWith(name),
    )!;
  const frame = () => root.querySelector<HTMLIFrameElement>('.inbox-reader__body')!;

  const open = async (id: string) => {
    fixture.componentRef.setInput('id', id);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    localStorage.clear();
    opened = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ComposeWindows,
          useValue: { open: async (options: (typeof opened)[number]) => opened.push(options) },
        },
      ],
    });
    fixture = TestBed.createComponent(InboxReader);
    root = fixture.nativeElement as HTMLElement;
    await open('launch');
  });

  it('reads the message: its header, and its body as a client draws it on the paper', () => {
    expect(root.querySelector('.inbox-reader__subject')?.textContent).toBe(INBOX[0].subject);
    const document = frame().getAttribute('srcdoc') ?? '';
    expect(document).toContain('Before Thursday');
    // A scriptless frame, its links out to a tab of their own.
    expect(frame().getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(document).toContain('<base target="_blank">');
  });

  it('reads on the editor’s paper, in the editor’s scheme', async () => {
    const island = root.querySelector('.inbox-reader')!;
    TestBed.inject(Preferences).editorAppearance.set('dark');
    await fixture.whenStable();
    expect(island.getAttribute('data-paper-scheme')).toBe('dark');
    expect(frame().getAttribute('srcdoc')).toContain('background: #1e1e1e');

    TestBed.inject(Preferences).editorAppearance.set('light');
    await fixture.whenStable();
    expect(island.getAttribute('data-paper-scheme')).toBe('light');
    expect(frame().getAttribute('srcdoc')).toContain('background: #ffffff');
  });

  it('says so where the id names no message', async () => {
    await open('nowhere');
    expect(root.querySelector('.inbox-reader')).toBeNull();
    expect(root.querySelector('.inbox-reader__missing')).not.toBeNull();
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
