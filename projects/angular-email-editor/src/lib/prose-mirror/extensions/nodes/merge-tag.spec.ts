import { createEditor, Editor } from '../../editor';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { lintHTML } from '../../html-source';
import { emailPlainText } from '../../plain-text';
import Handlebars from 'handlebars';
import { emailExtensions } from '../kits';
import { mergeTagFields } from './merge-tag';

const schema = createSchema(emailExtensions);
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

describe('merge-tag serialization', () => {
  it('promotes {{path}} to a node and serializes back — a fixpoint', () => {
    const doc = parseHTML('<div>Hi {{firstName}}!</div>', schema);
    let tags = 0;
    doc.descendants((node) => {
      if (node.type.name === 'mergeTag') tags++;
      return true;
    });
    expect(tags).toBe(1);

    const once = canonical('<div>Hi {{firstName}}!</div>');
    expect(once).toBe('<div>Hi {{firstName}}!</div>');
    expect(canonical(once)).toBe(once);
  });

  it("keeps an expression byte-verbatim — it is another system's program", () => {
    // AngularJS-style expressions (the iusta dialect): spacing, quotes and
    // filters must survive untouched, or the evaluator sees a different
    // program than the author wrote.
    for (const raw of [
      "<div>{{customer_gender == 'male' ? 'Herr' : 'Frau'}} {{customer_surname}}</div>",
      '<div>{{ mwst = round(parseFloat( cf_70 ) * 0.19, 2); mwst }}</div>',
      "<div>{{ cf_68 | calcDate:'+4 weeks' | formatDateDE}}</div>",
      '<div>{{ cf_69 }}</div>',
    ]) {
      const once = canonical(raw);
      expect(once).toBe(raw);
      expect(canonical(once)).toBe(once);
    }
  });

  it('promotes an expression to a single atomic node', () => {
    const doc = parseHTML("<div>{{ cf_71 ? 'JA' : 'NEIN' }}</div>", schema);
    let tags = 0;
    doc.descendants((node) => {
      if (node.type.name === 'mergeTag') tags++;
      return true;
    });
    expect(tags).toBe(1);
  });

  it('leaves block helpers and malformed braces alone — not ours to touch', () => {
    for (const raw of [
      '<div>{{#if premium}}yes{{/if}}</div>',
      '<div>{{&gt;partial}}</div>',
      '<div>a {{ dangling</div>',
    ]) {
      const once = canonical(raw);
      expect(once).toBe(raw);
    }
  });

  it('keeps marks across the round trip — a bold token stays bold', () => {
    const bold = '<div><b>Hi {{firstName}}</b></div>';
    const once = canonical(bold);
    expect(once).toContain('>Hi {{firstName}}</strong>');
    expect(canonical(once)).toBe(once);
  });

  it('appears verbatim in the text/plain projection', () => {
    expect(emailPlainText('<div>Hi {{firstName}},</div>')).toBe('Hi {{firstName}},');
  });

  it('produces lint-clean output', () => {
    expect(lintHTML(canonical('<div>Hi {{firstName}}!</div>'))).toEqual([]);
  });

  it('serialized output is a compilable Handlebars program — pills and blocks', () => {
    // Pills render as values; untouched block syntax still runs as blocks.
    const simple = canonical('<div>Hi {{firstName}}, order {{order_id}} is ready.</div>');
    expect(Handlebars.compile(simple)({ firstName: 'Ada', order_id: 'A-7' })).toBe(
      '<div>Hi Ada, order A-7 is ready.</div>',
    );

    const block = canonical(
      '<div>{{#if premium}}Danke, {{firstName}}!{{else}}Upgrade?{{/if}}</div>',
    );
    expect(Handlebars.compile(block)({ premium: true, firstName: 'Ada' })).toBe(
      '<div>Danke, Ada!</div>',
    );
    expect(Handlebars.compile(block)({ premium: false })).toBe('<div>Upgrade?</div>');
  });

  it('mergeTagFields extracts the fields a real template requires', () => {
    // A production iusta template, condensed: ternaries, locals, filters,
    // function calls, string literals, `now` — only the case data survives.
    const doc = parseHTML(
      "<div>{{customer_gender == 'male' ? 'Herr' : 'Frau'}} {{customer_surname}}</div>" +
        "<div>{{ cf_71 ? 'JA' : 'NEIN' }}</div>" +
        '<div>{{ mwst = round(parseFloat( cf_70 ) * 0.19, 2); mwst }}</div>' +
        '<div>{{parseFloat(cf_70) | formatPrice}}€ + {{mwst | formatPrice}}€</div>' +
        "<div>{{ cf_68 | calcDate:'+4 weeks' | formatDateDE}}</div>" +
        '<div>{{now | formatDateDE}}</div>' +
        '<div>{{doc_cf_67_storageKey}} {{case_name}}</div>',
      schema,
    );
    expect(mergeTagFields(doc)).toEqual([
      'customer_gender',
      'customer_surname',
      'cf_71',
      'cf_70',
      'cf_68',
      'doc_cf_67_storageKey',
      'case_name',
    ]);
    expect(mergeTagFields(parseHTML('<div>no tokens</div>', schema))).toEqual([]);
  });
});

describe('merge-tag editing', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: emailExtensions, content: '<div></div>' });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('insertMergeTag inserts a pill that serializes to the raw token', () => {
    expect(editor.commands['insertMergeTag']('firstName')).toBe(true);
    expect(editor.getHTML()).toContain('{{firstName}}');
    // The editor's own text projection carries the raw token too (leafText).
    expect(editor.getText()).toContain('{{firstName}}');
  });

  it('refuses an invalid path — the registry cannot inject syntax', () => {
    expect(editor.commands['insertMergeTag']('not a path')).toBe(false);
    expect(editor.commands['insertMergeTag']('{{nested}}')).toBe(false);
    expect(editor.getHTML()).not.toContain('{{');
  });

  it('typing the closing brace promotes the token (input rule)', () => {
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('Hi {{firstName}'));
      return true;
    });
    const end = editor.state.selection.from;
    const handled = editor.view.someProp('handleTextInput', (f) =>
      f(editor.view, end, end, '}', () => editor.state.tr.insertText('}', end, end)),
    );
    expect(handled).toBe(true);
    expect(editor.getHTML()).toBe('<div>Hi {{firstName}}</div>');
    let tags = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'mergeTag') tags++;
      return true;
    });
    expect(tags).toBe(1);
  });
});
