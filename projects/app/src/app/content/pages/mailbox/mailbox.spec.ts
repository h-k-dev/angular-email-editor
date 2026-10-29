import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ComposeWindows } from '../../../core/email/compose-windows';
import { Viewport } from '../../../core/layout/viewport';
import { provideExampleMail } from '../../../../../test/received-mail-fixture';
import { PageHeader } from '../../partials/common/page-header/page-header';
import { Mailbox } from './mailbox';

@Component({
  imports: [PageHeader],
  template: '<header page-header><h1>A page</h1></header><p class="page">a page</p>',
})
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
  const heading = (name: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('.mailbox-section__toggle')].find(
      (button) => button.textContent?.trim() === name,
    )!;
  const group = (name: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('.mailbox-group__toggle')].find(
      (button) => button.querySelector('.mailbox-group__label')?.textContent?.trim() === name,
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
              { path: 'api/:page', component: Page },
            ],
          },
        ]),
        {
          provide: Viewport,
          useValue: {
            narrow: compact.asReadonly(),
            compact: compact.asReadonly(),
            touch: signal(false).asReadonly(),
            floatingScrollbars: signal(true).asReadonly(),
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

    it('lays the mail and the calendar down the aside, the templates under them, then the developers: each reference a group of its pages, Render beside them', () => {
      const labels = [...root.querySelectorAll('.mailbox-link__label')].map((el) =>
        el.textContent?.trim(),
      );
      // A one-way trip: no place leads back to the composer's front page.
      expect(labels.slice(0, 3)).toEqual(['Inbox', 'Calendar', 'Templates']);
      // The calendar's link opens it, on today.
      expect(link('Calendar').getAttribute('href')).toBe('/calendar');
      expect(labels).toContain('Editor');
      expect(labels).toContain('Theming');
      expect(labels.at(-1)).toBe('Render');
      expect(heading('Developers')).toBeDefined();
      expect(group('API')).toBeDefined();
      expect(group('Styling')).toBeDefined();
      expect(group('Components')).toBeDefined();
      expect(link('Address input').closest('.mailbox-group')).toBe(
        group('Components').parentElement,
      );
      expect(link('Address input').getAttribute('href')).toBe('/components/address-input');
      // The utilities share the path, under a group of their own.
      expect(link('Keep focus').closest('.mailbox-group')).toBe(group('Utilities').parentElement);
      expect(link('Keep focus').getAttribute('href')).toBe('/components/focus');
      // Render is on the first level, beside the groups — not in one.
      expect(link('Render').closest('.mailbox-group')).toBeNull();
      expect(link('Addresses').closest('.mailbox-group')).toBe(group('API').parentElement);
      expect(root.querySelector('.mailbox-link[href="/"]')).toBeNull();
      expect(link('Templates').getAttribute('href')).toBe('/templates');
      expect(link('Addresses').getAttribute('href')).toBe('/api/addresses');
      expect(link('Theming').getAttribute('href')).toBe('/styling/theming');
    });

    it('folds a reference behind its row, and shows every page on the rail', async () => {
      const api = group('API');
      const pages = root.querySelector<HTMLElement>('#' + api.getAttribute('aria-controls'))!;
      expect(api.getAttribute('aria-expanded')).toBe('true');

      api.click();
      await harness.fixture.whenStable();
      expect(api.getAttribute('aria-expanded')).toBe('false');
      expect(pages.hidden).toBe(true);

      // The rail has no rows to unfold with: every place shows.
      toggle().click();
      await harness.fixture.whenStable();
      expect(pages.hidden).toBe(false);
      toggle().click();
      await harness.fixture.whenStable();

      api.click();
      await harness.fixture.whenStable();
      expect(pages.hidden).toBe(false);
    });

    it('marks a folded group that holds the place you are in', async () => {
      await harness.navigateByUrl('/api/addresses');
      const row = group('API').parentElement!;
      expect(row.classList).toContain('mailbox-group--current');
      expect(group('Styling').parentElement!.classList).not.toContain('mailbox-group--current');
    });

    it('folds the whole developers run behind its heading', async () => {
      const developers = heading('Developers');
      const run = root.querySelector<HTMLElement>('#' + developers.getAttribute('aria-controls'))!;
      developers.click();
      await harness.fixture.whenStable();
      expect(run.hidden).toBe(true);
      developers.click();
      await harness.fixture.whenStable();
      expect(run.hidden).toBe(false);
    });

    it('shows the page beside it, and says which place it is', () => {
      expect(root.querySelector('.mailbox-main .page')).not.toBeNull();
      expect(link('Inbox').getAttribute('aria-current')).toBe('page');
      expect(link('Addresses').hasAttribute('aria-current')).toBe(false);
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
      // A desk's rail is the aside itself: no opener of a phone's.
      expect(host().hasAttribute('data-closed')).toBe(false);
      expect(root.querySelector('.mailbox-opener')).toBeNull();

      toggle().click();
      await harness.fixture.whenStable();
      expect(host().hasAttribute('data-collapsed')).toBe(false);
    });

    it('follows the route to another place', async () => {
      await harness.navigateByUrl('/api/addresses');
      expect(link('Addresses').getAttribute('aria-current')).toBe('page');
      expect(link('Inbox').hasAttribute('aria-current')).toBe(false);
    });
  });

  describe('on a phone', () => {
    beforeEach(() => start(true));

    it('has no rail: shut, only its opener shows; opened, it lies over the page under a scrim', async () => {
      expect(host().hasAttribute('data-collapsed')).toBe(true);
      expect(host().hasAttribute('data-closed')).toBe(true);
      expect(root.querySelector('.mailbox-scrim')).toBeNull();
      const opener = root.querySelector<HTMLButtonElement>('.mailbox-opener')!;
      expect(opener.getAttribute('aria-label')).toBe('Expand sidebar');
      // It leads the page's own header — part of it, so it scrolls away
      // with a header that does.
      expect(opener.closest('.mailbox-main header[page-header]')).not.toBeNull();
      expect(opener.closest('header')!.querySelector('h1')!.compareDocumentPosition(opener)).toBe(
        Node.DOCUMENT_POSITION_PRECEDING,
      );

      opener.click();
      await harness.fixture.whenStable();
      expect(host().hasAttribute('data-over')).toBe(true);
      expect(host().hasAttribute('data-closed')).toBe(false);
      expect(root.querySelector('.mailbox-opener')).toBeNull();

      // The scrim closes it.
      (root.querySelector('.mailbox-scrim') as HTMLElement).click();
      await harness.fixture.whenStable();
      expect(host().hasAttribute('data-collapsed')).toBe(true);
      expect(root.querySelector('.mailbox-scrim')).toBeNull();
    });

    it('steps back to the rail once a place is picked, or on Escape', async () => {
      toggle().click();
      await harness.fixture.whenStable();
      link('Addresses').click();
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
