import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ComposeWindows } from '../../../../core/email/compose-windows';
import { INBOX } from '../../../../core/email/mailbox/mails';
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
      ],
    });
    harness = await RouterTestingHarness.create('/inbox');
    root = harness.fixture.nativeElement as HTMLElement;
  });

  it('lists the inbox, and shows a note while no message is open', () => {
    expect(root.querySelectorAll('.inbox-row')).toHaveLength(INBOX.length);
    expect(root.querySelector('app-inbox-empty')).not.toBeNull();
    expect(root.querySelector('[aria-current="page"]')).toBeNull();
    expect(host().hasAttribute('data-reading')).toBe(false);
  });

  it('opens a message as a place of its own: the row links to it, the pane reads it', async () => {
    expect(row('launch').getAttribute('href')).toBe('/inbox/launch');
    await harness.navigateByUrl('/inbox/launch');
    expect(root.querySelector('app-inbox-reader .inbox-reader__subject')?.textContent).toBe(
      INBOX[0].subject,
    );
    expect(row('launch').getAttribute('aria-current')).toBe('page');
    // On a phone the pane then takes the list's place.
    expect(host().hasAttribute('data-reading')).toBe(true);

    await harness.navigateByUrl('/inbox');
    expect(host().hasAttribute('data-reading')).toBe(false);
  });

  it('reads a message once it is opened, however it was reached', async () => {
    expect(row('launch').classList).toContain('inbox-row--unread');
    await harness.navigateByUrl('/inbox/launch');
    expect(row('launch').classList).not.toContain('inbox-row--unread');
    // Still unread: one not opened yet.
    expect(row('invoice').classList).toContain('inbox-row--unread');
  });
});
