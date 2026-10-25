/**
 * The table of contents' "what is being read", in real Chromium —
 * `npm run test:render` (jsdom has no layout). The page scrolls in a sheet
 * under a 48px sticky header, as a reference page does; a jump is what the
 * router does with a #fragment: the URL, then `scrollIntoView`.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { PageScrollerSheet } from '../../../../core/router/page-scroller';
import { DocSection } from '../doc-page/doc';
import { DocToc } from './doc-toc';

@Component({
  imports: [DocToc, PageScrollerSheet],
  template: `
    <div class="sheet" pageScroller>
      <header class="header">Where you are</header>
      <div class="body">
        <section id="a" class="anchor">
          <h2>A</h2>
          <p class="intro"></p>
          <article id="a1" class="anchor entry">a1</article>
          <article id="a2" class="anchor entry">a2</article>
          <article id="a3" class="anchor entry">a3</article>
        </section>
        <section id="b" class="anchor">
          <h2>B</h2>
          <p class="intro"></p>
          <article id="b1" class="anchor entry">b1</article>
          <article id="b2" class="anchor entry">b2</article>
        </section>
        <section id="c" class="anchor short"><h2>C</h2></section>
      </div>
      <nav docToc class="toc" [entries]="toc"></nav>
    </div>
  `,
  styles: `
    .sheet {
      --doc-header: 48px;
      position: relative;
      inline-size: 800px;
      block-size: 600px;
      overflow-y: auto;
    }
    .header {
      position: sticky;
      inset-block-start: 0;
      z-index: 1;
      block-size: 48px;
      background: white;
    }
    .toc {
      position: fixed;
      inset: 0 0 auto auto;
      inline-size: 200px;
    }
    .body {
      inline-size: 500px;
    }
    .anchor {
      scroll-margin-block-start: calc(var(--doc-header) + 16px);
    }
    section {
      margin-block-start: 56px;
    }
    .intro {
      block-size: 300px;
      margin: 0;
    }
    .entry {
      block-size: 64px;
      margin-block-start: 32px;
    }
    .short {
      block-size: 120px;
    }
  `,
})
class Page {
  protected readonly toc: readonly DocSection[] = [
    {
      id: 'a',
      title: 'A',
      topics: [
        { id: 'a1', title: 'a1' },
        { id: 'a2', title: 'a2' },
        { id: 'a3', title: 'a3' },
      ],
    },
    {
      id: 'b',
      title: 'B',
      topics: [
        { id: 'b1', title: 'b1' },
        { id: 'b2', title: 'b2' },
      ],
    },
    { id: 'c', title: 'C' },
  ];
}

describe('DocToc (render)', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  const root = () => harness.fixture.nativeElement as HTMLElement;
  const sheet = () => root().querySelector<HTMLElement>('.sheet')!;
  const frames = async (count = 3) => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
  };
  /** What is lit: the one entry marked as the place being read. */
  const lit = () =>
    [...root().querySelectorAll('[aria-current="location"]')].map((a) => a.textContent?.trim());

  /** A toc entry pressed: the URL takes the fragment, the router scrolls. */
  const jump = async (id: string) => {
    await router.navigate([], { fragment: id });
    root().querySelector(`#${id}`)!.scrollIntoView({ block: 'start' });
    await frames();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '', component: Page }])],
    });
    harness = await RouterTestingHarness.create('/');
    router = TestBed.inject(Router);
    document.body.append(root());
    await frames();
  });

  afterEach(() => root().remove());

  it('lights what a jump brought up, never the short entry under it', async () => {
    await jump('a2');
    expect(lit()).toEqual(['a2']);
    await jump('a1');
    expect(lit()).toEqual(['a1']);
    await jump('b1');
    expect(lit()).toEqual(['b1']);
  });

  it('lights a section jumped to, with none of its entries yet', async () => {
    await jump('b');
    expect(lit()).toEqual(['B']);
  });

  it('lights the last section jumped to at the foot of the page, where it cannot reach the top', async () => {
    await jump('c');
    expect(sheet().scrollTop + sheet().clientHeight).toBeGreaterThanOrEqual(
      sheet().scrollHeight - 2,
    );
    expect(lit()).toEqual(['C']);
  });

  it('follows the reader scrolling on their own', async () => {
    await jump('c');
    // The reader takes over: the jump is behind them.
    sheet().dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    const a3 = root().querySelector<HTMLElement>('#a3')!;
    sheet().scrollTop = a3.offsetTop - 64;
    await frames();
    expect(lit()).toEqual(['a3']);
  });

  it('lights nothing above the first section', async () => {
    sheet().scrollTop = 0;
    await frames();
    expect(lit()).toEqual([]);
  });
});
