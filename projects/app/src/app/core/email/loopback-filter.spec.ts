import { applyFilter } from './loopback-filter';

/** Rows enough to page, collate and escape against — a template store's
    names, German and English, with wildcard and regex characters in them. */
interface Row {
  id: string;
  name: string;
  dialect: 'angularjs' | 'handlebars';
}

const NAMES: [string, Row['dialect']][] = [
  ['Anrede & Bedingungen', 'angularjs'],
  ['Rechnen & Filter', 'angularjs'],
  ['Daten & calcDate', 'angularjs'],
  ['Lange Anrede (zweizeilig)', 'angularjs'],
  ['Tabelle & Spalten', 'angularjs'],
  ['Eingangsbestätigung', 'angularjs'],
  ['Terminbestätigung', 'angularjs'],
  ['Terminerinnerung', 'angularjs'],
  ['Unterlagen anfordern', 'angularjs'],
  ['Zahlungserinnerung', 'angularjs'],
  ['Mahnung (zweite Stufe)', 'angularjs'],
  ['Zahlungseingang bestätigt', 'angularjs'],
  ['Rückrufbitte', 'angularjs'],
  ['Simple fields', 'handlebars'],
  ['Blocks stay literal', 'handlebars'],
  ['Table & columns', 'handlebars'],
];

const ROWS: Row[] = NAMES.map(([name, dialect], index) => ({ id: `row-${index}`, name, dialect }));

const names = (rows: Row[]) => rows.map((row) => row.name);

describe('applyFilter', () => {
  it('filters by an ilike on the name, case-insensitively', () => {
    const rows = applyFilter(ROWS, { where: { name: { ilike: '%ERINNERUNG%' } }, order: 'name ASC' });
    expect(names(rows)).toEqual(['Terminerinnerung', 'Zahlungserinnerung']);
  });

  it('keeps like case-sensitive and honours _ and nlike', () => {
    expect(applyFilter(ROWS, { where: { name: { like: '%erinnerung%' } } })).toHaveLength(2);
    expect(applyFilter(ROWS, { where: { name: { like: '%ERINNERUNG%' } } })).toHaveLength(0);
    expect(applyFilter(ROWS, { where: { name: { like: 'Tabell_ & Spalten' } } })).toHaveLength(1);
    expect(applyFilter(ROWS, { where: { name: { nlike: '%erinnerung%' } } })).toHaveLength(
      ROWS.length - 2,
    );
  });

  it('treats regex characters in a pattern literally', () => {
    const rows = applyFilter(ROWS, { where: { name: { ilike: '%(zweite stufe)%' } } });
    expect(names(rows)).toEqual(['Mahnung (zweite Stufe)']);
    expect(applyFilter(ROWS, { where: { name: { ilike: '%.*%' } } })).toHaveLength(0);
  });

  it('reads a backslash as making the next wildcard literal', () => {
    expect(applyFilter(ROWS, { where: { name: { ilike: '%\\%%' } } })).toHaveLength(0);
    expect(applyFilter(ROWS, { where: { name: { ilike: 'Tabell\\_%' } } })).toHaveLength(0);
    expect(applyFilter(ROWS, { where: { name: { ilike: 'Tabell_%' } } })).toHaveLength(1);
  });

  it('matches equality, inq, and and/or', () => {
    expect(applyFilter(ROWS, { where: { dialect: 'handlebars' } })).toHaveLength(3);

    const both = applyFilter(ROWS, {
      where: { name: { inq: ['Simple fields', 'Rückrufbitte'] } },
      order: 'name ASC',
    });
    expect(names(both)).toEqual(['Rückrufbitte', 'Simple fields']);

    const or = applyFilter(ROWS, {
      where: { or: [{ name: { ilike: 'simple%' } }, { name: { ilike: 'mahnung%' } }] },
    });
    expect(or).toHaveLength(2);

    const and = applyFilter(ROWS, {
      where: { and: [{ dialect: 'angularjs' }, { name: { ilike: '%tabelle%' } }] },
    });
    expect(names(and)).toEqual(['Tabelle & Spalten']);
  });

  it('pages with order, skip and limit, the pages adding up to the whole', () => {
    const all = applyFilter(ROWS, { order: 'name ASC' });
    const first = applyFilter(ROWS, { order: 'name ASC', limit: 6 });
    const second = applyFilter(ROWS, { order: 'name ASC', skip: 6, limit: 6 });
    const last = applyFilter(ROWS, { order: 'name ASC', skip: 12, limit: 6 });

    expect(first).toHaveLength(6);
    expect([...first, ...second, ...last].map((row) => row.id)).toEqual(all.map((row) => row.id));
    expect(applyFilter(ROWS, { order: 'name ASC', skip: all.length, limit: 6 })).toEqual([]);
  });

  it('orders descending, with German collation', () => {
    const rows = applyFilter(ROWS, { order: 'name DESC', limit: 2 });
    expect(names(rows)).toEqual(['Zahlungserinnerung', 'Zahlungseingang bestätigt']);
  });

  it('hands out copies, so a caller cannot edit the rows', () => {
    const [row] = applyFilter(ROWS, { limit: 1 });
    row.name = 'changed';
    expect(ROWS[0].name).not.toBe('changed');
  });
});
