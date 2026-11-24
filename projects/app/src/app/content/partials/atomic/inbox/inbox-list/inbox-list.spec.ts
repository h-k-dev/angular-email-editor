import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideExampleMail } from '../../../../../../../test/received-mail-fixture';
import { ReceivedMail } from '../../../../../core/email/mailbox/received-mail';
import { InboxList } from './inbox-list';

// Gmail's conversations: the messages that answer one another are one row.
describe('InboxList, with a conversation in the inbox', () => {
  let root: HTMLElement;
  let mailbox: ReceivedMail;
  const row = (id: string) =>
    root.querySelector<HTMLElement>(`[role="row"]:has(a[href$="${id}"])`)!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideExampleMail([], { conversation: true })],
    });
    mailbox = TestBed.inject(ReceivedMail);
    const fixture = TestBed.createComponent(InboxList);
    root = fixture.nativeElement as HTMLElement;
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(root.querySelectorAll('.inbox-row')).toHaveLength(4);
    });
  });

  it('lists it as one row: its latest message, and how many there are', () => {
    expect(root.querySelector('a[href$="talk-1"], a[href$="talk-2"]')).toBeNull();
    const named = row('talk-3')
      .getAttribute('aria-labelledby')!
      .split(' ')
      .map((id) => root.querySelector('#' + id));
    expect(
      named.map((part) => part?.getAttribute('aria-label') ?? part?.textContent?.trim()),
    ).toEqual(['Ravi Patel', '3 messages', 'Unread', 'Aug 18', 'Re: Offsite agenda']);
    // The count the eye reads is no generic element named by `aria-label`:
    // assistive tech has the row's name, the eye the digit.
    const count = row('talk-3').querySelector('.inbox-row__count')!;
    expect(count.textContent).toBe('3');
    expect(count.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('[aria-label="3 messages"]')).toBeNull();
  });

  it('fetches every message of the conversation when its row is pointed at', () => {
    const prefetch = vi.spyOn(mailbox, 'prefetch');
    row('talk-3').dispatchEvent(new Event('pointerenter'));
    expect(prefetch.mock.calls.map(([id]) => id).sort()).toEqual(['talk-1', 'talk-2', 'talk-3']);
  });

  it('marks the whole of it read, and moves the whole of it out', async () => {
    const press = (name: string) =>
      row('talk-3').querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!.click();

    press('Mark as read');
    expect(['talk-1', 'talk-2', 'talk-3'].some((id) => mailbox.unread().has(id))).toBe(false);

    // An earlier message starred shows the conversation starred, and unstarring clears it.
    mailbox.toggleStar('talk-1');
    await vi.waitFor(() =>
      expect(
        row('talk-3').querySelector('.inbox-actions__star')?.getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    press('Star');
    expect(['talk-1', 'talk-2', 'talk-3'].some((id) => mailbox.starred().has(id))).toBe(false);

    press('Move to archive');
    expect(mailbox.inbox().map(({ id }) => id)).toEqual([
      'reply-plain-note',
      'reply-text-only',
      'mjml-austin',
    ]);
  });
});
