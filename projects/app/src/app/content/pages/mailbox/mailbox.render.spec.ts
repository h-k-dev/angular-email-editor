/**
 * The mailbox's scrolling, in real Chromium — `npm run test:render` (jsdom
 * has no layout). A page you read scrolls the document, so a phone pulls
 * it down to refresh; the aside holds still beside it. A page you work in
 * — the inbox's two panes on a desk — is a frame: the viewport's height,
 * each pane scrolling inside itself, the document never.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { page } from 'vitest/browser';

import { ComposeWindows } from '../../../core/email/compose-windows';
import { PageScroller } from '../../../core/router/page-scroller';
import { provideExampleMail } from '../../../../../test/received-mail-fixture';
import { MailboxAside } from '../../partials/atomic/mailbox/mailbox-aside';
import { InboxEmpty } from '../../partials/atomic/inbox/inbox-empty/inbox-empty';
import { PageHeader } from '../../partials/common/page-header/page-header';
import { Inbox } from './inbox/inbox';
import { Mailbox } from './mailbox';

/** A page you read, far taller than the screen. */
@Component({
  imports: [PageHeader],
  template: '<header page-header><h1>A page</h1></header><div class="long"></div>',
  styles: '.long { block-size: 3000px; }',
})
class LongPage {}

describe('Mailbox scrolling (render)', () => {
  let harness: RouterTestingHarness;
  let root: HTMLElement;

  const doc = () => document.scrollingElement as HTMLElement;
  const main = () => root.querySelector('.mailbox-main') as HTMLElement;
  const aside = () => root.querySelector('.mailbox-aside') as HTMLElement;
  const list = () => root.querySelector('.inbox-list') as HTMLElement;
  /** The inbox's list made long: rows enough to outgrow any screen. */
  const lengthen = () => {
    const spacer = document.createElement('li');
    spacer.style.blockSize = '3000px';
    list().querySelector('ul')!.append(spacer);
  };
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  const start = async (width: number, height: number, url: string) => {
    await page.viewport(width, height);
    // What the shell gives its pages (app.scss, styles.scss).
    document.documentElement.style.setProperty('--app-frame', '100dvh');
    document.body.style.margin = '0';
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            {
              path: '',
              component: Mailbox,
              children: [
                { path: 'inbox', component: Inbox, children: [{ path: '', component: InboxEmpty }] },
                { path: 'read', component: LongPage },
              ],
            },
          ],
          withComponentInputBinding(),
        ),
        { provide: ComposeWindows, useValue: { open: async () => undefined } },
        provideExampleMail(),
      ],
    });
    harness = await RouterTestingHarness.create(url);
    root = harness.fixture.nativeElement as HTMLElement;
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      if (url === '/inbox') expect(root.querySelectorAll('.inbox-row')).toHaveLength(3);
    });
    window.scrollTo(0, 0);
  };

  afterEach(() => {
    window.scrollTo(0, 0);
    document.documentElement.style.removeProperty('--app-frame');
    document.body.style.margin = '';
  });

  describe('on a phone', () => {
    it('scrolls a page in the document, not in a sheet of its own', async () => {
      await start(375, 667, '/read');
      expect(getComputedStyle(main()).overflowY).toBe('visible');
      expect(doc().scrollHeight).toBeGreaterThan(window.innerHeight + 2000);
      expect(TestBed.inject(PageScroller).scroller).toBe(doc());

      window.scrollTo(0, 500);
      await frame();
      expect(window.scrollY).toBe(500);
    });

    it('scrolls the inbox list in the document, its header held at the top', async () => {
      await start(375, 667, '/inbox');
      expect(getComputedStyle(list()).overflowY).toBe('visible');
      lengthen();
      await frame();
      expect(doc().scrollHeight).toBeGreaterThan(window.innerHeight + 2000);

      const header = root.querySelector('.inbox-side > header') as HTMLElement;
      const row = root.querySelector('.inbox-row') as HTMLElement;
      const rowTop = row.getBoundingClientRect().top;
      window.scrollTo(0, 400);
      await frame();
      expect(row.getBoundingClientRect().top).toBeCloseTo(rowTop - 400, 0);
      expect(header.getBoundingClientRect().top).toBe(0);
    });

    it('lays the opened aside over the screen wherever the document stands', async () => {
      await start(375, 667, '/read');
      window.scrollTo(0, 800);
      const mailbox = harness.fixture.debugElement.query(By.directive(Mailbox));
      mailbox.injector.get(MailboxAside).collapsed.set(false);
      await harness.fixture.whenStable();

      const box = aside().getBoundingClientRect();
      expect(getComputedStyle(aside()).position).toBe('fixed');
      expect(box.top).toBe(0);
      expect(box.height).toBe(window.innerHeight);
      const scrim = root.querySelector('.mailbox-scrim') as HTMLElement;
      expect(scrim.getBoundingClientRect().top).toBe(0);
      expect(scrim.getBoundingClientRect().height).toBe(window.innerHeight);
    });
  });

  describe('on a desk', () => {
    it('holds the aside beside a page scrolling the document', async () => {
      await start(1280, 800, '/read');
      window.scrollTo(0, 600);
      await frame();
      expect(window.scrollY).toBe(600);
      const box = aside().getBoundingClientRect();
      expect(box.top).toBe(0);
      expect(box.height).toBe(window.innerHeight);
    });

    it('keeps the inbox a frame: the list scrolls inside, the document never', async () => {
      await start(1280, 800, '/inbox');
      lengthen();
      await frame();
      expect(doc().scrollHeight).toBe(window.innerHeight);
      expect(list().scrollHeight).toBeGreaterThan(list().clientHeight + 2000);
      list().scrollTop = 300;
      expect(list().scrollTop).toBe(300);
    });
  });
});
