/**
 * The MJML examples as our own blocks — `examples/mjml-induce/`, one file for
 * each example in `examples/mjml/`, under the same name: what the builder
 * import makes of it, the editor's own HTML, formatted as the source pane
 * formats it. Each file must be what the import makes today — run with
 * `UPDATE_INDUCED=1` to write them anew — and our own HTML, imported again,
 * must come back unchanged. How each looks beside its original is the
 * render suite's (`mjml-examples.render.spec.ts`).
 */
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { formatHTML } from './html-source';
import { emailExtensions } from './extensions/kits';

const node = (globalThis as any).process;
const fs = node.getBuiltinModule('fs');
const EXAMPLES = 'projects/app/public/examples/';

interface ExampleSet {
  key: string;
  examples: { name: string; file: string }[];
}
const sets: ExampleSet[] = JSON.parse(fs.readFileSync(`${EXAMPLES}index.json`, 'utf8')).sets;
const filesOf = (key: string): string[] =>
  (sets.find((set) => set.key === key)?.examples ?? []).map((e) => e.file.split('/').pop()!);

const schema = createSchema(emailExtensions);
const canonical = (html: string): string => serializeToHTML(parseHTML(html, schema), schema);
const read = (path: string): string => fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('MJML examples induced as our own blocks', () => {
  it('has an induced example for every MJML example, under the same name', () => {
    expect(filesOf('mjml-induce')).toEqual(filesOf('mjml'));
  });

  for (const file of filesOf('mjml')) {
    const source = read(`${EXAMPLES}mjml/${file}`);
    const path = `${EXAMPLES}mjml-induce/${file}`;
    const made = `${formatHTML(canonical(source))}\n`;

    it(`${file}: the induced file is what the import makes of the original today`, () => {
      if (node.env['UPDATE_INDUCED']) {
        fs.mkdirSync(`${EXAMPLES}mjml-induce`, { recursive: true });
        fs.writeFileSync(path, made.replace(/\n/g, '\r\n'));
      }
      expect(read(path)).toBe(made);
    });

    it(`${file}: our own HTML, imported again, comes back as itself`, () => {
      expect(canonical(read(path))).toBe(canonical(source));
    });
  }
});
