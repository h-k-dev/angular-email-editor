import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { API_PAGE_CONTENT } from './api-reference.content';
import { API_PAGES } from './api-pages';
import { ApiReference } from './api-reference';

describe('ApiReference', () => {
  const open = async (page: string) => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ApiReference);
    fixture.componentRef.setInput('page', page);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('has content for every page the aside lists, and every export a unique id', () => {
    expect(API_PAGE_CONTENT.map((page) => page.id)).toEqual(API_PAGES.map((page) => page.id));
    const ids = API_PAGE_CONTENT.flatMap((page) => [
      ...page.sections.map((section) => section.id),
      ...page.sections.flatMap((section) => section.entries.map((entry) => entry.id)),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows each export as a card: name, entry point, summary and its signature as code', async () => {
    const root = await open('addresses');
    const cards = [...root.querySelectorAll<HTMLElement>('article.doc-entry')];
    const addresses = API_PAGE_CONTENT.find((page) => page.id === 'addresses')!;
    expect(cards.length).toBe(addresses.sections[0].entries.length);

    const first = cards[0];
    expect(first.querySelector('.doc-entry__name')?.textContent?.trim()).toBe('AddressRules');
    expect(first.querySelector('.doc-entry__from')?.textContent).toContain('/address');
    expect(first.querySelector('doc-code .doc-code__label')?.textContent?.trim()).toBe('Signature');
    // Prose `backticks` are code.
    expect(first.querySelector('.doc-points code')).not.toBeNull();
  });

  it('parts a page of several sections by headings, and lists them in the toc', async () => {
    const root = await open('editor');
    const headings = [...root.querySelectorAll('.doc-h2')].map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Editor', 'Kits & authoring', 'Built-in behaviour']);
    expect(root.querySelector('nav[docToc] a[href$="#create-editor"]')).not.toBeNull();
  });
});
