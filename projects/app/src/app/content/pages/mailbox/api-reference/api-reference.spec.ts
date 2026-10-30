import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { API_PAGE_CONTENT, stepCode } from './api-reference.content';
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

  it('shows each export as a step: its name, a line, and code — never a bare signature', async () => {
    const root = await open('addresses');
    const steps = [...root.querySelectorAll<HTMLElement>('li.doc-step')];
    const addresses = API_PAGE_CONTENT.find((page) => page.id === 'addresses')!;
    expect(steps.length).toBe(addresses.sections[0].entries.length);

    const first = steps[0];
    expect(first.id).toBe('address-rules');
    expect(first.querySelector('.doc-step__lead')?.textContent?.trim()).toBe('AddressRules');
    // No example: the import from its entry point, the signature, the notes
    // as comments — no bullets under it. The code is highlighted
    // asynchronously: waited for, with room for a busy runner.
    const code = await vi.waitFor(
      () => {
        const text = first.querySelector('doc-code pre')?.textContent ?? '';
        expect(text).toContain('AddressRules');
        return text;
      },
      { timeout: 5000 },
    );
    expect(code).toContain("import { AddressRules } from '@h-k-dev/angular-email-editor/address';");
    expect(code).toContain('AddressRules: ');
    expect(code).toContain('// identity: ');
    expect(root.querySelector('.doc-points')).toBeNull();
  });

  it('says what to know in code: notes only where no example carries it', () => {
    const entries = API_PAGE_CONTENT.flatMap((page) => page.sections.flatMap((s) => s.entries));
    expect(entries.filter((entry) => entry.example && entry.notes)).toEqual([]);
    expect(entries.every((entry) => entry.code)).toBe(true);
  });

  it('pairs ·-joined names with their signatures, and leaves an element without an import', () => {
    expect(
      stepCode({
        id: 'x',
        name: 'a · b',
        signature: '() => 1 · () => 2',
        summary: '',
        notes: ['n'],
      }),
    ).toBe(
      "import { a, b } from '@h-k-dev/angular-email-editor';\n\na: () => 1\nb: () => 2\n\n// n",
    );
    expect(
      stepCode({
        id: 'x',
        name: 'email-menu',
        from: 'lib/menu',
        signature: '<email-menu>',
        summary: '',
      }),
    ).toBe('// lib/menu\n\n<email-menu>');
  });

  it('parts a page of several sections by headings, and lists them in the toc', async () => {
    const root = await open('editor');
    const headings = [...root.querySelectorAll('.doc-h2')].map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Editor', 'Kits & authoring', 'Built-in behaviour']);
    // the trail names the page: no title or lede of its own repeats the first section
    expect(root.querySelector('.doc-title, .doc-lede')).toBeNull();
    expect(root.querySelector('nav[docToc] a[href$="#create-editor"]')).not.toBeNull();
  });
});
