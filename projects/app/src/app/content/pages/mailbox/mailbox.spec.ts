import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ComposeWindows } from '../../../core/email/compose-windows';
import { Viewport } from '../../../core/layout/viewport';
import { provideExampleMail } from '../../../../../test/received-mail-fixture';
import { Mailbox } from './mailbox';

@Component({ template: '<p class="page">a page</p>' })
class Page {}

describe('Mailbox', () => {
  let harness: RouterTestingHarness;
  let root: HTMLElement;
  let opened: number;
  /** The screen: a phone's or a desk's. */
  const compact = signal(false);

  const link = (name: string) =>
    [...root.querySelectorAll<HTMLAnchorElement>('.mailbox-link')].find(
      (a) => a.querySelector('.mailbox-link__label')?.textContent?.trim() === name,
    )!;
  const host = () => root.querySelector('app-mailbox') as HTMLElement;
  const toggle = () => root.querySelector('.mailbox-aside__toggle') as HTMLButtonElement;
  const compose = () => root.querySelector('.mailbox-aside__compose') as HTMLButtonElement;

  const start = async (phone: boolean) => {
    compact.set(phone);
    opened = 0;
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
        {
          provide: Viewport,
          useValue: {
            narrow: compact.asReadonly(),
            compact: compact.asReadonly(),
            touch: signal(false).asReadonly(),
            keyboardInset: signal(0).asReadonly(),
          },
        },
        { provide: ComposeWindows, useValue: { open: async () => opened++ } },
        provideExampleMail(),
      ],
    });
    harness = await RouterTestingHarness.create('/inbox');
    root = harness.fixture.nativeElement as HTMLElement;
  };

  describe('on a desk', () => {
    beforeEach(() => start(false));

    it('lays the places down the aside, the reference pages under a heading of their own', () => {
      const labels = [...root.querySelectorAll('.mailbox-link__label')].map((el) =>
        el.textContent?.trim(),
      );
      expect(labels).toEqual(['Composer', 'Inbox', 'API', 'Styling', 'Render']);
      expect(root.querySelector('.mailbox-section__title')?.textContent?.trim()).toBe(
        'Developers',
      );
      expect(link('Composer').getAttribute('href')).toBe('/');
    });

    it('shows the page beside it, and says which place it is', () => {
      expect(root.querySelector('.mailbox-main .page')).not.toBeNull();
      expect(link('Inbox').getAttribute('aria-current')).toBe('page');
      expect(link('API').hasAttribute('aria-current')).toBe(false);
    });

    it('counts what is unread in the inbox', async () => {
      // The fixture's three messages, none opened yet.
      await vi.waitFor(async () => {
        await harness.fixture.whenStable();
        expect(link('Inbox').querySelector('.mailbox-link__count')?.textContent?.trim()).toBe('3');
      });
    });

    it('heads the aside with the rail toggle and Compose written out, the settings at its foot', () => {
      const head = root.querySelector('.mailbox-aside__head')!;
      expect(head.firstElementChild).toBe(toggle());
      expect(compose().textContent?.trim()).toContain('Compose');
      compose().click();
      expect(opened).toBe(1);
      const foot = root.querySelector('.mailbox-aside__foot')!;
      expect(foot.querySelector('[aria-label^="Language"]')).not.toBeNull();
      expect(foot.querySelector('theme-toggle button')).not.toBeNull();
    });

    it('folds to the rail and back, beside the page', async () => {
      expect(host().hasAttribute('data-collapsed')).toBe(false);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(toggle().getAttribute('aria-label')).toBe('Collapse sidebar');

      toggle().click();
      await harness.fixture.whenStable();
      expect(host().hasAttribute('data-collapsed')).toBe(true);
      expect(host().hasAttribute('data-over')).toBe(false);
      expect(toggle().getAttribute('aria-label')).toBe('Expand sidebar');

      toggle().click();
      await harness.fixture.whenStable();
      expect(host().hasAttribute('data-collapsed')).toBe(false);
    });

    it('follows the route to another place', async () => {
      await harness.navigateByUrl('/api');
      expect(link('API').getAttribute('aria-current')).toBe('page');
      expect(link('Inbox').hasAttribute('aria-current')).toBe(false);
    });
  });

  describe('on a phone', () => {
    beforeEach(() => start(true));

    it('rests as the rail, and opens over the page under a scrim', async () => {
      expect(host().hasAttribute('data-collapsed')).toBe(true);
      expect(root.querySelector('.mailbox-scrim')).toBeNull();

      toggle().click();
      await harness.fixture.whenStable();
      expect(host().hasAttribute('data-over')).toBe(true);

      // The scrim closes it.
      (root.querySelector('.mailbox-scrim') as HTMLElement).click();
      await harness.fixture.whenStable();
      expect(host().hasAttribute('data-collapsed')).toBe(true);
      expect(root.querySelector('.mailbox-scrim')).toBeNull();
    });

    it('steps back to the rail once a place is picked, or on Escape', async () => {
      toggle().click();
      await harness.fixture.whenStable();
      link('API').click();
      await harness.fixture.whenStable();
      expect(host().hasAttribute('data-over')).toBe(false);

      toggle().click();
      await harness.fixture.whenStable();
      host().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await harness.fixture.whenStable();
      expect(host().hasAttribute('data-over')).toBe(false);
    });
  });
});
