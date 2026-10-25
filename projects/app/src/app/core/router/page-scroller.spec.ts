import { ViewportScroller } from '@angular/common';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createApplication } from '@angular/platform-browser';
import { NavigationSkipped, Router, RouterOutlet, provideRouter, withInMemoryScrolling } from '@angular/router';

import { filter, firstValueFrom } from 'rxjs';

import { PageScroller } from './page-scroller';

@Component({ template: '<p id="far">far</p>' })
class Page {}

@Component({ selector: 'app-root', imports: [RouterOutlet], template: '<router-outlet />' })
class Root {}

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

describe('PageScroller', () => {
  let scroller: PageScroller;
  let sheet: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'a', component: Page },
            { path: 'b', component: Page },
          ],
          withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
        ),
        { provide: ViewportScroller, useExisting: PageScroller },
      ],
    });
    scroller = TestBed.inject(PageScroller);
    sheet = document.createElement('div');
    document.body.append(sheet);
  });

  afterEach(() => sheet.remove());

  it('reads and moves the attached sheet, not the window', () => {
    const release = scroller.attach(sheet);
    sheet.scrollTo = vi.fn();
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    sheet.scrollTop = 120;

    expect(scroller.getScrollPosition()).toEqual([0, 120]);
    scroller.scrollToPosition([0, 300]);
    expect(sheet.scrollTo).toHaveBeenCalledWith({ left: 0, top: 300 });
    expect(windowScroll).not.toHaveBeenCalled();

    // Released, the window scrolls again.
    release();
    scroller.scrollToPosition([0, 10]);
    expect(windowScroll).toHaveBeenCalledWith({ left: 0, top: 10 });
    windowScroll.mockRestore();
  });

  it('lands a #fragment on its element', () => {
    const target = document.createElement('h2');
    target.id = 'section';
    target.scrollIntoView = vi.fn();
    document.body.append(target);

    scroller.scrollToAnchor('section');
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    target.remove();
  });

  it('leaves the page where it is for a back press on the same URL', async () => {
    // A real bootstrap: it is what starts the router's history listener
    // and its scrolling.
    const app = await createApplication({
      providers: [
        provideRouter(
          [
            { path: 'a', component: Page },
            { path: 'b', component: Page },
          ],
          withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
        ),
        { provide: ViewportScroller, useExisting: PageScroller },
      ],
    });
    const host = document.createElement('app-root');
    document.body.append(host);
    app.bootstrap(Root, host);
    const router = app.injector.get(Router);
    const pages = app.injector.get(PageScroller);
    await router.navigateByUrl('/a');
    await settle();
    pages.attach(sheet);
    sheet.scrollTo = vi.fn();

    // What a guard over the page does: one more entry, same URL — then
    // the back press that takes it.
    history.pushState({ ...(history.state ?? {}), __backGuard: 1 }, '');
    const skipped = firstValueFrom(router.events.pipe(filter((e) => e instanceof NavigationSkipped)));
    history.back();
    await skipped;
    await settle();
    expect(sheet.scrollTo).not.toHaveBeenCalled();

    // A real navigation still starts the next page at its top.
    await router.navigateByUrl('/b');
    await settle();
    expect(sheet.scrollTo).toHaveBeenCalledWith({ left: 0, top: 0 });

    app.destroy();
    host.remove();
  });
});
