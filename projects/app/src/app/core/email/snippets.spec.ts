import { TestBed } from '@angular/core/testing';
import { stubExampleAssets } from '../../../../test/examples-fixture';
import { Snippets } from './snippets';

describe('Snippets', () => {
  let service: Snippets;

  /** A call with the latency skipped. */
  const settle = async <T>(pending: Promise<T>): Promise<T> => {
    await vi.runAllTimersAsync();
    return pending;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    stubExampleAssets();
    TestBed.configureTestingModule({});
    service = TestBed.inject(Snippets);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('answers after a latency, like a server', async () => {
    let answered = false;
    service.find({ limit: 1 }).then(() => (answered = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(answered).toBe(true);
  });

  it('holds the catalogue’s snippets, each id its file’s name and its text trimmed', async () => {
    const rows = await settle(service.find({ order: 'name ASC' }));
    expect(rows.map((row) => [row.id, row.name])).toEqual([
      ['greeting', 'Greeting'],
      ['next-steps', 'Next steps'],
      ['sign-off', 'Sign-off'],
    ]);
    expect(rows[0].html).toBe('<div>Hello {{ firstName }},</div>');
  });

  it('answers a LoopBack filter', async () => {
    const rows = await settle(service.find({ where: { name: { ilike: '%SIGN%' } } }));
    expect(rows.map((row) => row.id)).toEqual(['sign-off']);
  });

  it('finds one by id, and none for an id it does not hold', async () => {
    expect((await settle(service.findById('greeting')))?.name).toBe('Greeting');
    expect(await settle(service.findById('nope'))).toBeNull();
  });

  it('creates, saves and removes — and answers copies, never its own rows', async () => {
    const made = await settle(service.create({ name: 'New', html: '<div>Hi</div>' }));
    expect(made.id).toBe('snippet-1');
    made.name = 'changed outside';
    expect((await settle(service.findById('snippet-1')))?.name).toBe('New');

    await settle(service.save({ ...made, name: 'Renamed' }));
    expect((await settle(service.findById('snippet-1')))?.name).toBe('Renamed');

    await settle(service.remove('snippet-1'));
    expect(await settle(service.findById('snippet-1'))).toBeNull();
    await expect(service.save(made)).rejects.toThrow('No snippet snippet-1');
  });

  it('cancels with its signal', async () => {
    const controller = new AbortController();
    const pending = service.find({}, controller.signal);
    const caught = pending.catch((error: DOMException) => error.name);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await caught).toBe('AbortError');
  });
});
