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
  let fetched: string[];

  const host = () => root.querySelector('app-inbox') as HTMLElement;
  const row = (id: string) =>
    [...root.querySelectorAll<HTMLAnchorElement>('.inbox-row')].find((a) =>
      a.getAttribute('href')?.endsWith(`/${id}`),
    )!;
  /** A row of the grid: its link, its avatar's checkbox, its actions. */
  const item = (id: string) => row(id).closest<HTMLElement>('[role="row"]')!;
  const action = (id: string, name: string) =>
    item(id).querySelector<HTMLButtonElement>(`.inbox-actions button[aria-label="${name}"]`)!;
  const settle = () => harness.fixture.whenStable();
  /** The reader fetches the message by its id: on screen once it has come. */
  const opened = () =>
    vi.waitFor(() =>
      expect(root.querySelector('app-inbox-reader .mail-view__subject')).not.toBeNull(),
    );

  beforeEach(async () => {
    fetched = [];
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
        provideExampleMail(fetched),
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
    await opened();
    expect(root.querySelector('app-inbox-reader .mail-view__subject')?.textContent).toBe(
      'Plain note',
    );
    expect(item('reply-plain-note').getAttribute('aria-current')).toBe('page');
    // On a phone the pane then takes the list's place.
    expect(host().hasAttribute('data-reading')).toBe(true);

    await harness.navigateByUrl('/inbox');
    expect(host().hasAttribute('data-reading')).toBe(false);
  });

  it('shows a date the message wrote out as short as the rest, and none where it has none', () => {
    const when = (id: string) => row(id).querySelector('.inbox-row__when')?.textContent?.trim();
    // "Aug 18, 2026, 4:32 PM", as the message wrote it: not today, so its day.
    expect(when('reply-plain-note')).toBe('Aug 18');
    expect(when('mjml-austin')).toBe('');
  });

  it('leads each row with its sender’s avatar: the initials, in the row’s hue — the sender’s own', () => {
    const avatar = (id: string) => item(id).querySelector<HTMLElement>('.inbox-row__avatar')!;
    expect(avatar('reply-plain-note').textContent?.trim()).toBe('JD');
    expect(avatar('mjml-austin').textContent?.trim()).toBe('A');
    expect(avatar('reply-plain-note').getAttribute('aria-hidden')).toBe('true');
    // The row is the hue's container (its wash, its frame); the avatar wears it.
    expect(item('reply-plain-note').classList).toContain('hued');
    const hue = Number(item('reply-plain-note').style.getPropertyValue('--avatar-hue'));
    expect(Number.isInteger(hue) && hue >= 0 && hue < 360).toBe(true);
    expect(avatar('reply-plain-note').style.getPropertyValue('--avatar-hue')).toBe('');
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
    await opened();
    const pane = root.querySelector('.inbox-pane')!;
    // The reader's button turns the page's paper (InboxPaper).
    const button = root.querySelector<HTMLButtonElement>('.mail-view__paper')!;
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
    // From one message straight to the next — the reader stays, its id
    // changes: that one is read too.
    await harness.navigateByUrl('/inbox/mjml-austin');
    expect(row('mjml-austin').classList).not.toContain('inbox-row--unread');
  });

  it('reads a message reached by a link straight to it', async () => {
    await harness.navigateByUrl('/');
    await harness.navigateByUrl('/inbox/mjml-austin');
    await vi.waitFor(() => expect(row('mjml-austin')).toBeDefined());
    expect(row('mjml-austin').classList).not.toContain('inbox-row--unread');
    expect(host().hasAttribute('data-reading')).toBe(true);
  });

  it('lists from the headers alone, and fetches a body when its path is opened', async () => {
    expect(fetched).toEqual(['inbox.json']);
    await harness.navigateByUrl('/inbox/mjml-austin');
    await harness.fixture.whenStable();
    expect(fetched).toEqual(['inbox.json', 'mjml/austin.html']);
    expect(root.querySelector('email-viewer iframe')?.getAttribute('srcdoc')).toContain(
      '<title>Discount Light</title>',
    );
  });

  it('fetches a row’s body as it is pointed at or focused: open, it is there already', async () => {
    item('reply-plain-note').dispatchEvent(new PointerEvent('pointerenter'));
    item('mjml-austin').dispatchEvent(new FocusEvent('focus'));
    await vi.waitFor(() =>
      expect(fetched).toEqual(['inbox.json', 'reply/plain-note.json', 'mjml/austin.html']),
    );
    await harness.navigateByUrl('/inbox/reply-plain-note');
    await harness.fixture.whenStable();
    expect(fetched).toHaveLength(3);
  });

  it('marks a message read or unread again from its row', async () => {
    expect(row('reply-plain-note').classList).toContain('inbox-row--unread');
    action('reply-plain-note', 'Mark as read').click();
    await settle();
    expect(row('reply-plain-note').classList).not.toContain('inbox-row--unread');

    action('reply-plain-note', 'Mark as unread').click();
    await settle();
    expect(row('reply-plain-note').classList).toContain('inbox-row--unread');
  });

  it('stars a message: the star pressed, and a filled one beside its date', async () => {
    const star = action('reply-plain-note', 'Star');
    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(row('reply-plain-note').querySelector('.inbox-row__starred')).toBeNull();

    star.click();
    await settle();
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(
      row('reply-plain-note').querySelector('.inbox-row__starred')?.getAttribute('aria-label'),
    ).toBe('Starred');
  });

  it('moves a message out to the trash, the archive or snoozed — the open one closes with it', async () => {
    await harness.navigateByUrl('/inbox/reply-plain-note');
    action('reply-plain-note', 'Move to trash').click();
    await settle();
    expect(row('reply-plain-note')).toBeUndefined();
    expect(host().hasAttribute('data-reading')).toBe(false);
    expect(root.querySelector('app-inbox-empty')).not.toBeNull();

    action('mjml-austin', 'Move to archive').click();
    await settle();
    expect(row('mjml-austin')).toBeUndefined();
    expect(root.querySelectorAll('.inbox-row')).toHaveLength(1);
  });

  it('takes a moved message back with the snackbar’s Undo', async () => {
    action('mjml-austin', 'Snooze').click();
    await settle();
    expect(row('mjml-austin')).toBeUndefined();
    const undo = [
      ...document.querySelectorAll<HTMLButtonElement>('.mat-mdc-snack-bar-container button'),
    ].find((button) => button.textContent?.trim() === 'Undo')!;
    undo.click();
    await settle();
    expect(row('mjml-austin')).toBeDefined();
  });

  it('ticks a row’s checkbox through its avatar, the box shown while ticked', async () => {
    const box = item('reply-plain-note').querySelector<HTMLInputElement>('.inbox-pick__box input')!;
    expect(box.getAttribute('aria-label')).toBe('Select Jane Doe');
    box.click();
    await settle();
    expect(box.checked).toBe(true);
    expect(item('reply-plain-note').getAttribute('aria-selected')).toBe('true');
  });

  /** A key pressed where focus is. */
  const press = async (key: string) => {
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    await settle();
  };

  it('is a grid of rows, one of them the tab stop: the open one, else the first', async () => {
    const grid = root.querySelector('[role="grid"]')!;
    expect(grid.getAttribute('aria-label')).toBe('Inbox');
    expect(grid.getAttribute('aria-multiselectable')).toBe('true');
    const stops = () =>
      [...root.querySelectorAll('[role="row"]')].map((r) => r.getAttribute('tabindex'));
    expect(stops()).toEqual(['0', '-1', '-1']);
    // Nothing else in the list is a stop.
    expect(root.querySelector('#inbox-list a')?.getAttribute('tabindex')).toBe('-1');
    expect(item('reply-plain-note').querySelector('input')?.tabIndex).toBe(-1);
    expect(action('reply-plain-note', 'Star').getAttribute('tabindex')).toBe('-1');

    await harness.navigateByUrl('/inbox/mjml-austin');
    const at = [...root.querySelectorAll('[role="row"]')].indexOf(item('mjml-austin'));
    expect(stops()[at]).toBe('0');
    expect(stops().filter((stop) => stop === '0')).toHaveLength(1);
  });

  it('names a row by its sender, state, date and subject — never its controls', () => {
    const named = item('reply-plain-note')
      .getAttribute('aria-labelledby')!
      .split(' ')
      .map((id) => root.querySelector('#' + id)?.textContent?.trim());
    expect(named).toEqual(['Jane Doe', 'Unread', 'Aug 18', 'Plain note']);
  });

  it('moves with the arrows, opens with Enter and ticks with Space', async () => {
    const rows = [...root.querySelectorAll<HTMLElement>('[role="row"]')];
    rows[0].focus();
    await press('ArrowDown');
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].getAttribute('tabindex')).toBe('0');
    expect(rows[0].getAttribute('tabindex')).toBe('-1');

    await press(' ');
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    expect(rows[1].querySelector('input')?.checked).toBe(true);

    await press('Enter');
    await vi.waitFor(() => expect(rows[1].getAttribute('aria-current')).toBe('page'));
  });

  it('reaches a row’s checkbox and actions with the arrows, Escape back to the row', async () => {
    const at = item('reply-plain-note');
    at.focus();
    await press('ArrowRight');
    expect(document.activeElement).toBe(at.querySelector('input'));
    await press('ArrowRight');
    expect(document.activeElement).toBe(action('reply-plain-note', 'Mark as read'));
    await press('End');
    expect(document.activeElement).toBe(action('reply-plain-note', 'Star'));
    await press('Escape');
    expect(document.activeElement).toBe(at);
  });

  it('hands focus to the next row when the focused one moves out', async () => {
    const trash = action('reply-plain-note', 'Move to trash');
    trash.focus();
    const next = [...root.querySelectorAll<HTMLElement>('[role="row"]')][1];
    trash.click();
    await settle();
    expect(row('reply-plain-note')).toBeUndefined();
    expect(document.activeElement).toBe(next);
    expect(next.getAttribute('tabindex')).toBe('0');
  });
});
