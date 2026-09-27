import { vi } from 'vitest';

/**
 * An example catalogue for a jsdom spec, where nothing answers a fetch:
 * stubs `fetch` to serve `examples/index.json` and its files from memory
 * — the catalogue's own sets and names, a stand-in body each. Undone by
 * `vi.restoreAllMocks()`.
 */
export function stubExampleAssets(): void {
  // The catalogue's own names (public/examples/index.json), so the store's
  // specs search what the app ships.
  const angularjs = [
    'Anrede & Bedingungen',
    'Rechnen & Filter',
    'Daten & calcDate',
    'Lange Anrede (zweizeilig)',
    'Sehr lange Anrede (dreizeilig)',
    'Tabelle & Spalten',
  ];
  const handlebars = ['Simple fields', 'Blocks stay literal', 'Table & columns'];
  const everyday = [
    'Eingangsbestätigung',
    'Terminbestätigung',
    'Terminerinnerung',
    'Unterlagen anfordern',
    'Zahlungserinnerung',
    'Mahnung (zweite Stufe)',
    'Zahlungseingang bestätigt',
    'Vollmacht zur Unterschrift',
    'Sachstandsmitteilung',
    'Fristverlängerung beantragt',
    'Mandatsbeendigung',
    'Abwesenheitsnotiz',
    'Rückrufbitte',
    'Kostenvoranschlag',
    'Vergleichsangebot weitergeleitet',
    'Feedback erbeten',
  ];
  const files = new Map<string, string>();
  const set = (key: string, dialect: string, names: string[]) => ({
    key,
    label: `${key} example`,
    short: key,
    kind: 'html',
    dialect,
    examples: names.map((name, index) => {
      const file = `${key}/${index}.html`;
      files.set(file, `<div>${name}: {{ customer_surname }}</div>`);
      return { name, file };
    }),
  });
  files.set(
    'index.json',
    JSON.stringify({
      sets: [
        set('angularjs', 'angularjs', angularjs),
        set('handlebars', 'handlebars', handlebars),
        set('everyday', 'angularjs', everyday),
      ],
    }),
  );
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = files.get(url.slice(url.indexOf('examples/') + 'examples/'.length));
    return body === undefined
      ? new Response('', { status: 404, statusText: 'Not Found' })
      : new Response(body);
  });
}
