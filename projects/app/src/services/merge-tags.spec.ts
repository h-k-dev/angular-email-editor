import { TestBed } from '@angular/core/testing';
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
    expect(rows).toEqual([{ path: 'company.name', label: 'Company' }]);
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
    const pending = service.find({}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    const already = service.find({}, { signal: controller.signal });
    await expect(already).rejects.toMatchObject({ name: 'AbortError' });
  });
});
