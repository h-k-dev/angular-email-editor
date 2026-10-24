import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ComposeWindows } from '../../../../core/email/compose-windows';
import { provideExampleMail } from '../../../../../../test/received-mail-fixture';
import { Preferences } from '../../../../core/storages/preferences';
import { InboxEmpty } from '../../../partials/atomic/inbox/inbox-empty/inbox-empty';
import { InboxReader } from '../../../partials/atomic/inbox/inbox-reader/inbox-reader';
import { Inbox } from './inbox';

describe('Inbox', () => {
  let harness: RouterTestingHarness;
  let root: HTMLElement;

  const host = () => root.querySelector('app-inbox') as HTMLElement;
  const row = (id: string) =>
    [...root.querySelectorAll<HTMLAnchorElement>('.inbox-row')].find((a) =>
      a.getAttribute('href')?.endsWith(`/${id}`),
    )!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            {
              path: 'inbox',
              component: Inbox,
              children: [
                { path: '', component: InboxEmpty },
                { path: ':id', component: InboxReader },
              ],
            },
          ],
          withComponentInputBinding(),
        ),
        { provide: ComposeWindows, useValue: { open: async () => undefined } },
        provideExampleMail(),
      ],
    });
    harness = await RouterTestingHarness.create('/inbox');
    root = harness.fixture.nativeElement as HTMLElement;
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(root.querySelectorAll('.inbox-row')).toHaveLength(3);
    });
  });

  it('lists the inbox, and shows a note while no message is open', () => {
    expect(root.querySelectorAll('.inbox-row')).toHaveLength(3);
    expect(root.querySelector('app-inbox-empty')).not.toBeNull();
    expect(root.querySelector('[aria-current="page"]')).toBeNull();
    expect(host().hasAttribute('data-reading')).toBe(false);
  });

  it('opens a message as a place of its own: the row links to it, the pane reads it', async () => {
    expect(row('reply-plain-note').getAttribute('href')).toBe('/inbox/reply-plain-note');
    await harness.navigateByUrl('/inbox/reply-plain-note');
    expect(root.querySelector('app-inbox-reader .inbox-reader__subject')?.textContent).toBe(
      'Plain note',
    );
    expect(row('reply-plain-note').getAttribute('aria-current')).toBe('page');
    // On a phone the pane then takes the list's place.
    expect(host().hasAttribute('data-reading')).toBe(true);

    await harness.navigateByUrl('/inbox');
    expect(host().hasAttribute('data-reading')).toBe(false);
  });

  it('shows a date as the message wrote it, and none where it has none', () => {
    const when = (id: string) => row(id).querySelector('.inbox-row__when')?.textContent?.trim();
    expect(when('reply-plain-note')).toBe('Aug 18, 2026, 4:32 PM');
    expect(when('mjml-austin')).toBe('');
  });

  it('gives each half its own header, the two the same height', () => {
    const side = root.querySelector('.inbox-side > header[page-header]');
    const pane = root.querySelector('.inbox-pane > header[page-header]');
    expect(side).not.toBeNull();
    expect(pane).not.toBeNull();
  });

  it('reads the mail on paper, turned light or dark by its button whatever the app is', async () => {
    localStorage.clear();
    TestBed.inject(Preferences).editorAppearance.set('light');
    await harness.navigateByUrl('/inbox/reply-plain-note');
    const pane = root.querySelector('.inbox-pane')!;
    // The reader's button turns the page's paper (InboxPaper).
    const button = root.querySelector<HTMLButtonElement>('.inbox-reader__paper')!;
    expect(pane.getAttribute('data-paper-scheme')).toBe('light');
    expect(button.getAttribute('aria-label')).toBe('Read on dark paper');

    button.click();
    await harness.fixture.whenStable();
    expect(pane.getAttribute('data-paper-scheme')).toBe('dark');
    expect(button.getAttribute('aria-label')).toBe('Read on light paper');
    expect(root.querySelector('email-viewer iframe')?.getAttribute('srcdoc')).toContain(
      'background: #1e1e1e',
    );
    // The list's half keeps the app's surface: it is no island.
    expect(root.querySelector('.inbox-side')!.hasAttribute('data-paper-scheme')).toBe(false);
  });

  it('reads a message once it is opened, however it was reached', async () => {
    expect(row('reply-plain-note').classList).toContain('inbox-row--unread');
    await harness.navigateByUrl('/inbox/reply-plain-note');
    expect(row('reply-plain-note').classList).not.toContain('inbox-row--unread');
    // Still unread: one not opened yet.
    expect(row('mjml-austin').classList).toContain('inbox-row--unread');
  });
});
