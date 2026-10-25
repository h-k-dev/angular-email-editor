import { TestBed } from '@angular/core/testing';
import { scanMergeTags } from '@h-k-dev/angular-email-editor';
import { MergeTags } from './merge-tags';

describe('MergeTags', () => {
  let service: MergeTags;

  /** A find with the latency skipped. */
  const find = async (...args: Parameters<MergeTags['find']>) => {
    const pending = service.find(...args);
    await vi.runAllTimersAsync();
    return pending;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(MergeTags);
  });

  afterEach(() => vi.useRealTimers());

  it('holds enough fields to need paging', async () => {
    expect((await find()).length).toBeGreaterThan(40);
  });

  it('searches path or label, case-insensitively', async () => {
    const like = '%COMPANY%';
    const rows = await find({
      where: { or: [{ path: { ilike: like } }, { label: { ilike: like } }] },
    });
    expect(rows).toEqual([
      { path: 'company.name', label: 'Company' },
      { path: 'company.website', label: 'Company website' },
      { path: 'company.address', label: 'Company address' },
      { path: 'company.logoUrl', label: 'Company logo URL' },
      { path: 'company.bannerUrl', label: 'Company banner image URL' },
    ]);
  });

  it('sorts numbers by value, so the custom fields page in order', async () => {
    const rows = await find({
      where: { path: { like: 'custom.%' } },
      order: 'label ASC',
      skip: 8,
      limit: 3,
    });
    expect(rows.map((row) => row.label)).toEqual([
      'Custom field 9',
      'Custom field 10',
      'Custom field 11',
    ]);
  });

  it('rejects with an AbortError when the request is cancelled', async () => {
    const controller = new AbortController();
    const pending = service.find({}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    const already = service.find({}, controller.signal);
    await expect(already).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fills the sample contact by path, and nothing for a path it does not name', async () => {
    const pending = service.resolve(['firstName', 'company.name', 'constructor', 'toString']);
    await vi.runAllTimersAsync();
    // Inherited keys of an object are no paths: the lookup is a Map's.
    expect(await pending).toEqual(['Ada', 'Analytical Engines Ltd', '', '']);
  });

  it('fills every custom-field placeholder of the AngularJS example, its choices as their words', async () => {
    const fs = (globalThis as any).process.getBuiltinModule('fs');
    const html: string = fs.readFileSync(
      'projects/app/public/examples/angularjs/platzhalter-im-ueberblick.html',
      'utf8',
    );
    const expressions = scanMergeTags(html)
      .map(({ expr: [from, to] }) => html.slice(from, to))
      .filter((expression) => expression.includes('custom.'));
    const pending = service.resolve(expressions);
    await vi.runAllTimersAsync();
    const values = await pending;

    expect(expressions.length).toBe(7);
    expect(values.filter((value) => !value)).toEqual([]);
    expect(values).toContain('Swoosh (figurative mark)');
    expect(values).toContain('Marketplace listing');
  });
});
