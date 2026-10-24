import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { INBOX } from '../inbox/mails';
import { Mailbox } from './mailbox';

@Component({ template: '<p class="page">a page</p>' })
class Page {}

describe('Mailbox', () => {
  let harness: RouterTestingHarness;
  let root: HTMLElement;

  const link = (name: string) =>
    [...root.querySelectorAll<HTMLAnchorElement>('.mailbox-link')].find(
      (a) => a.querySelector('.mailbox-link__label')?.textContent?.trim() === name,
    )!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', pathMatch: 'full', component: Page },
          {
            path: '',
            component: Mailbox,
            children: [
              { path: 'inbox', component: Page },
              { path: 'api', component: Page },
            ],
          },
        ]),
      ],
    });
    harness = await RouterTestingHarness.create('/inbox');
    root = harness.routeNativeElement as HTMLElement;
  });

  it('lays the places down the aside, the reference pages under a heading of their own', () => {
    const labels = [...root.querySelectorAll('.mailbox-link__label')].map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(['Composer', 'Inbox', 'API', 'Styling', 'Render']);
    expect(root.querySelector('.mailbox-section__title')?.textContent?.trim()).toBe('Developers');
    expect(link('Composer').getAttribute('href')).toBe('/');
  });

  it('shows the page beside it, and says which place it is', () => {
    expect(root.querySelector('.mailbox-main .page')).not.toBeNull();
    expect(link('Inbox').getAttribute('aria-current')).toBe('page');
    expect(link('API').hasAttribute('aria-current')).toBe(false);
  });

  it('counts what is unread in the inbox', () => {
    const unread = INBOX.filter((mail) => mail.unread).length;
    expect(link('Inbox').querySelector('.mailbox-link__count')?.textContent?.trim()).toBe(
      String(unread),
    );
  });

  it('heads the aside with the app and Compose, and keeps the settings at its foot', () => {
    const head = root.querySelector('.mailbox-aside__head')!;
    expect(head.querySelector('[aria-label="Compose"]')).not.toBeNull();
    const foot = root.querySelector('.mailbox-aside__foot')!;
    expect(foot.querySelector('[aria-label^="Language"]')).not.toBeNull();
    expect(foot.querySelector('theme-toggle button')).not.toBeNull();
  });

  it('follows the route to another place', async () => {
    await harness.navigateByUrl('/api');
    expect(link('API').getAttribute('aria-current')).toBe('page');
    expect(link('Inbox').hasAttribute('aria-current')).toBe(false);
  });
});
