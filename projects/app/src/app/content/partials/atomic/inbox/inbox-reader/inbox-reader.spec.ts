import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ComposeWindows } from '../../../../../core/email/compose-windows';
import { ReceivedMail } from '../../../../../core/email/mailbox/received-mail';
import { provideExampleMail } from '../../../../../../../test/received-mail-fixture';
import { Preferences } from '../../../../../core/storages/preferences';
import { ToolbarMenu } from '../../../shared/email/email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';
import { InboxPaper } from '../inbox-paper';
import { InboxReader } from './inbox-reader';

describe('InboxReader', () => {
  let fixture: ComponentFixture<InboxReader>;
  let root: HTMLElement;
  let opened: Parameters<ComposeWindows['open']>[0][];

  const button = (name: string) =>
    root.querySelector<HTMLButtonElement>(`.inbox-reader__line button[aria-label="${name}"]`)!;
  /** Picks an answer from ⋮. */
  const more = (value: string) =>
    fixture.debugElement.query(By.directive(ToolbarMenu)).componentInstance.selected.emit(value);
  const frame = () => root.querySelector<HTMLIFrameElement>('email-viewer iframe')!;

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
        provideExampleMail(),
        // The inbox page's, in the app.
        InboxPaper,
      ],
    });
    const mail = TestBed.inject(ReceivedMail);
    await vi.waitFor(() => expect(mail.settled()).toBe(true));
    fixture = TestBed.createComponent(InboxReader);
    root = fixture.nativeElement as HTMLElement;
    await open('reply-plain-note');
  });

  it('heads the message as Gmail does, without the avatar: subject, sender, then date and the buttons', () => {
    expect(root.querySelector('.inbox-reader__name')?.textContent).toBe('Jane Doe');
    expect(root.querySelector('.inbox-reader__address')?.textContent).toBe('<jane@example.com>');
    const line = [...root.querySelector('.inbox-reader__line')!.children].map((el) => el.className);
    expect(line).toEqual(['inbox-reader__who', 'inbox-reader__date', 'inbox-reader__actions']);
    const buttons = [...root.querySelectorAll('.inbox-reader__actions button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    // The paper button left of Reply, the rest in ⋮.
    expect(buttons).toEqual(['Read on dark paper', 'Reply', 'More']);
  });

  it('reads the message: its header, and its body as a client draws it on the paper', () => {
    expect(root.querySelector('.inbox-reader__subject')?.textContent).toBe('Plain note');
    expect(root.querySelector('.inbox-reader__date')?.textContent).toBe('Aug 18, 2026, 4:32 PM');
    const document = frame().getAttribute('srcdoc') ?? '';
    expect(document).toContain('Are we still on');
    // A scriptless frame, its links out to a tab of their own.
    expect(frame().getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(document).toContain('<base target="_blank">');
  });

  it('reads on the reading paper: the editor’s to start with, either at will', async () => {
    TestBed.inject(Preferences).editorAppearance.set('dark');
    await fixture.whenStable();
    expect(frame().getAttribute('srcdoc')).toContain('background: #1e1e1e');

    // Turned the other way by hand: the button, which turns the page's paper.
    button('Read on light paper').click();
    await fixture.whenStable();
    expect(TestBed.inject(InboxPaper).scheme()).toBe('light');
    expect(frame().getAttribute('srcdoc')).toContain('background: #ffffff');

    // The editor's paper changing takes the reading paper with it.
    TestBed.inject(Preferences).editorAppearance.set('dark');
    await fixture.whenStable();
    TestBed.inject(Preferences).editorAppearance.set('light');
    await fixture.whenStable();
    expect(frame().getAttribute('srcdoc')).toContain('background: #ffffff');
  });

  it('reads a newsletter whole: its own document, in the frame, edge to edge', async () => {
    await open('mjml-austin');
    expect(root.querySelector('.inbox-reader__subject')?.textContent).toBe('Discount Light');
    expect(frame().getAttribute('srcdoc')).toContain('<title>Discount Light</title>');
    expect(frame().getAttribute('srcdoc')).not.toContain('padding-inline');
  });

  it('lines a simple email’s text up under its header: the header’s 32px inset', () => {
    expect(frame().getAttribute('srcdoc')).toContain('padding-inline: 32px');
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
    expect(options?.content?.message.to).toEqual(['Jane Doe <jane@example.com>']);
    expect(options?.content?.message.subject).toBe('Re: Plain note');
    expect(options?.content?.message.quoted).toContain('Are we still on');
  });

  it('Reply all copies everyone else on the message — on one sent to us alone, nobody', () => {
    more('reply-all');
    expect(opened[0]?.content?.message.to).toEqual(['Jane Doe <jane@example.com>']);
    expect(opened[0]?.content?.message.cc).toEqual([]);
  });

  it('Forward has nobody to go to yet: the caret starts in To', () => {
    more('forward');
    const [options] = opened;
    expect(options?.focus).toBe('to');
    expect(options?.content?.message.to).toEqual([]);
    expect(options?.content?.message.subject).toBe('Fwd: Plain note');
  });
});
