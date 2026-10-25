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
  const angularjs = ['Platzhalter im Überblick', 'Sign-in code', 'Order confirmation'];
  // The one entry the catalogue gives an envelope (a no-reply sender).
  const envelopes: Record<string, object> = {
    'Sign-in code': {
      from: ['no-reply@example.com'],
      subject: '{{ otp.code }} is your {{ company.name }} sign-in code',
    },
  };
  const handlebars = ['Fields & blocks', 'Table & columns'];
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
      return { name, file, ...(envelopes[name] && { envelope: envelopes[name] }) };
    }),
  });
  files.set(
    'index.json',
    JSON.stringify({
      sets: [
        set('angularjs', 'angularjs', angularjs),
        set('handlebars', 'handlebars', handlebars),
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
