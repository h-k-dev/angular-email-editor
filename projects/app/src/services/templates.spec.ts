import { TestBed } from '@angular/core/testing';
import { Templates } from './templates';

describe('Templates', () => {
  let service: Templates;

  /** A find with the latency skipped. */
  const find = async (...args: Parameters<Templates['find']>) => {
    const pending = service.find(...args);
    await vi.runAllTimersAsync();
    return pending;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(Templates);
  });

  afterEach(() => vi.useRealTimers());

  it('answers after a latency, like a server', async () => {
    let answered = false;
    service.find({ limit: 1 }).then(() => (answered = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(answered).toBe(true);
  });

  it('holds more templates than one page of twelve', async () => {
    expect((await find()).length).toBeGreaterThan(12);
  });

  it('filters by an ilike on the name, case-insensitively', async () => {
    const rows = await find({ where: { name: { ilike: '%ERINNERUNG%' } }, order: 'name ASC' });
    expect(rows.map((row) => row.name)).toEqual(['Terminerinnerung', 'Zahlungserinnerung']);
  });

  it('keeps like case-sensitive and honours _ and nlike', async () => {
    expect(await find({ where: { name: { like: '%erinnerung%' } } })).toHaveLength(2);
    expect(await find({ where: { name: { like: '%ERINNERUNG%' } } })).toHaveLength(0);
    expect((await find({ where: { name: { like: 'Tabell_ & Spalten' } } })).length).toBe(1);

    const all = await find();
    const rest = await find({ where: { name: { nlike: '%erinnerung%' } } });
    expect(rest).toHaveLength(all.length - 2);
  });

  it('treats regex characters in a pattern literally', async () => {
    const rows = await find({ where: { name: { ilike: '%(zweite stufe)%' } } });
    expect(rows.map((row) => row.name)).toEqual(['Mahnung (zweite Stufe)']);
    expect(await find({ where: { name: { ilike: '%.*%' } } })).toHaveLength(0);
  });

  it('reads a backslash as making the next wildcard literal', async () => {
    expect(await find({ where: { name: { ilike: '%\\%%' } } })).toHaveLength(0);
    expect(await find({ where: { name: { ilike: 'Tabell\\_%' } } })).toHaveLength(0);
    expect(await find({ where: { name: { ilike: 'Tabell_%' } } })).toHaveLength(1);
  });

  it('matches equality, inq, and and/or', async () => {
    const handlebars = await find({ where: { dialect: 'handlebars' } });
    expect(handlebars.length).toBe(3);

    const both = await find({
      where: { name: { inq: ['Simple fields', 'Rückrufbitte'] } },
      order: 'name ASC',
    });
    expect(both.map((row) => row.name)).toEqual(['Rückrufbitte', 'Simple fields']);

    const or = await find({
      where: { or: [{ name: { ilike: 'simple%' } }, { name: { ilike: 'mahnung%' } }] },
    });
    expect(or).toHaveLength(2);

    const and = await find({
      where: { and: [{ dialect: 'angularjs' }, { name: { ilike: '%tabelle%' } }] },
    });
    expect(and.map((row) => row.name)).toEqual(['Tabelle & Spalten']);
  });

  it('pages with order, skip and limit, the pages adding up to the whole', async () => {
    const all = await find({ order: 'name ASC' });
    const first = await find({ order: 'name ASC', limit: 12 });
    const second = await find({ order: 'name ASC', skip: 12, limit: 12 });
    const last = await find({ order: 'name ASC', skip: 24, limit: 12 });

    expect(first).toHaveLength(12);
    expect([...first, ...second, ...last].map((row) => row.id)).toEqual(all.map((row) => row.id));
    expect(await find({ order: 'name ASC', skip: all.length, limit: 12 })).toEqual([]);
  });

  it('orders descending, with German collation', async () => {
    const rows = await find({ order: 'name DESC', limit: 2 });
    expect(rows.map((row) => row.name)).toEqual([
      'Zahlungserinnerung',
      'Zahlungseingang bestätigt',
    ]);
  });

  it('hands out copies, so a caller cannot edit the store', async () => {
    const [row] = await find({ limit: 1 });
    row.name = 'changed';
    const [again] = await find({ limit: 1 });
    expect(again.name).not.toBe('changed');
  });
});
