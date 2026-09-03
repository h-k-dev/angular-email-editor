import { createEditor, Editor } from '../../editor';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { lintHTML } from '../../html-source';
import { emailPlainText } from '../../plain-text';
import Handlebars from 'handlebars';
import { TextSelection } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { emailExtensions } from '../kits';
import {
  MAX_MERGE_TAG_LENGTH,
  isMergeTagExpression,
  mergeTagFields,
  mergeTagRanges,
  selectionInsideMergeTag,
} from './merge-tag';

const schema = createSchema(emailExtensions);
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);
const tokens = (doc: Node) => mergeTagRanges(doc).length;
/** Whether every character of the token at `index` carries the pill mark. */
const marked = (doc: Node, index = 0): boolean => {
  const tag = mergeTagRanges(doc)[index];
  if (!tag) return false;
  let whole = true;
  doc.nodesBetween(tag.from, tag.to, (node) => {
    if (node.isText && !doc.type.schema.marks['mergeTag'].isInSet(node.marks)) whole = false;
  });
  return whole;
};

describe('merge-tag serialization', () => {
  it('marks {{ path }} and serializes back — a fixpoint', () => {
    const doc = parseHTML('<div>Hi {{ firstName }}!</div>', schema);
    expect(tokens(doc)).toBe(1);
    expect(marked(doc)).toBe(true);

    const once = canonical('<div>Hi {{ firstName }}!</div>');
    expect(once).toBe('<div>Hi {{ firstName }}!</div>');
    expect(canonical(once)).toBe(once);
  });

  it("keeps an expression byte-verbatim — it is another system's program", () => {
    for (const raw of [
      "<div>{{ customer_gender == 'male' ? 'Herr' : 'Frau' }} {{ customer_surname }}</div>",
      '<div>{{ mwst = round(parseFloat( cf_70 ) * 0.19, 2); mwst }}</div>',
      "<div>{{ cf_68 | calcDate:'+4 weeks' | formatDateDE }}</div>",
      '<div>{{ cf_69 }}</div>',
    ]) {
      const once = canonical(raw);
      expect(once).toBe(raw);
      expect(canonical(once)).toBe(once);
    }
  });

  it('marks an expression as a single token', () => {
    const doc = parseHTML("<div>{{ cf_71 ? 'JA' : 'NEIN' }}</div>", schema);
    expect(tokens(doc)).toBe(1);
    expect(marked(doc)).toBe(true);
  });

  it('leaves block helpers and malformed braces alone — not ours to touch', () => {
    for (const raw of [
      '<div>{{#if premium}}yes{{/if}}</div>',
      '<div>{{&gt;partial}}</div>',
      '<div>a {{ dangling</div>',
    ]) {
      expect(canonical(raw)).toBe(raw);
      expect(tokens(parseHTML(raw, schema))).toBe(0);
    }
  });

  it('keeps marks across the round trip — a bold token stays bold', () => {
    const bold = '<div><b>Hi {{ firstName }}</b></div>';
    const once = canonical(bold);
    expect(once).toContain('>Hi {{ firstName }}</strong>');
    expect(canonical(once)).toBe(once);
  });

  it('repairs a partially formatted token to whole — formatting is all-or-nothing', () => {
    expect(canonical('<div><b>{{ first</b>Name }} x</div>')).toBe(
      '<div><strong style="font-weight: bold;">{{ firstName }}</strong> x</div>',
    );
  });

  it('appears verbatim in the text/plain projection', () => {
    expect(emailPlainText('<div>Hi {{ firstName }},</div>')).toBe('Hi {{ firstName }},');
  });

  it('produces lint-clean output', () => {
    expect(lintHTML(canonical('<div>Hi {{ firstName }}!</div>'))).toEqual([]);
  });

  it('serialized output is a compilable Handlebars program — tokens and blocks', () => {
    const simple = canonical('<div>Hi {{ firstName }}, order {{ order_id }} is ready.</div>');
    expect(Handlebars.compile(simple)({ firstName: 'Ada', order_id: 'A-7' })).toBe(
      '<div>Hi Ada, order A-7 is ready.</div>',
    );

    const block = canonical(
      '<div>{{#if premium}}Danke, {{ firstName }}!{{else}}Upgrade?{{/if}}</div>',
    );
    expect(Handlebars.compile(block)({ premium: true, firstName: 'Ada' })).toBe(
      '<div>Danke, Ada!</div>',
    );
    expect(Handlebars.compile(block)({ premium: false })).toBe('<div>Upgrade?</div>');
  });

  it('mergeTagFields extracts the fields a real template requires', () => {
    const doc = parseHTML(
      "<div>{{ customer_gender == 'male' ? 'Herr' : 'Frau' }} {{ customer_surname }}</div>" +
        "<div>{{ cf_71 ? 'JA' : 'NEIN' }}</div>" +
        '<div>{{ mwst = round(parseFloat( cf_70 ) * 0.19, 2); mwst }}</div>' +
        '<div>{{ parseFloat(cf_70) | formatPrice }}€ + {{ mwst | formatPrice }}€</div>' +
        "<div>{{ cf_68 | calcDate:'+4 weeks' | formatDateDE }}</div>" +
        '<div>{{ now | formatDateDE }}</div>' +
        '<div>{{ doc_cf_67_storageKey }} {{ case_name }}</div>',
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

describe('merge-tag — the two-line expression', () => {
  // The example app's 'Lange Anrede (zweizeilig)': a correct AngularJS nested
  // ternary, 171 characters inside the braces — wider than the 600px column.
  const LONG =
    "{{ customer_gender == 'male' ? 'Sehr geehrter Herr ' + customer_surname : customer_gender == 'female' ? 'Sehr geehrte Frau ' + customer_surname : 'Guten Tag ' + customer_name }}";

  it('is one token that round-trips verbatim', () => {
    const html = `<div>${LONG},</div>`;
    expect(canonical(html)).toBe(html);
    expect(tokens(parseHTML(html, schema))).toBe(1);
  });

  it('requires exactly the three fields the ternary reads', () => {
    expect(mergeTagFields(parseHTML(`<div>${LONG}</div>`, schema))).toEqual([
      'customer_gender',
      'customer_surname',
      'customer_name',
    ]);
  });
});

describe('merge-tag — the three-line expression and the ceiling', () => {
  // The example app's 'Sehr lange Anrede (dreizeilig)': four branches, string
  // concatenation, 301 characters inside the braces.
  const LONGER =
    "{{ customer_gender == 'male' ? 'Sehr geehrter Herr ' + customer_title + ' ' + customer_surname : customer_gender == 'female' ? 'Sehr geehrte Frau ' + customer_title + ' ' + customer_surname : customer_gender == 'diverse' ? 'Guten Tag ' + customer_firstname + ' ' + customer_surname : 'Sehr geehrte Damen und Herren' }}";

  it('is one token that round-trips verbatim and reads its four fields', () => {
    const html = `<div>${LONGER},</div>`;
    expect(canonical(html)).toBe(html);
    const doc = parseHTML(html, schema);
    expect(tokens(doc)).toBe(1);
    expect(mergeTagFields(doc)).toEqual([
      'customer_gender',
      'customer_title',
      'customer_surname',
      'customer_firstname',
    ]);
  });

  it('protects up to the ceiling and leaves a runaway alone', () => {
    expect(MAX_MERGE_TAG_LENGTH).toBe(1000);
    expect(isMergeTagExpression('a'.repeat(MAX_MERGE_TAG_LENGTH))).toBe(true);
    expect(isMergeTagExpression('a'.repeat(MAX_MERGE_TAG_LENGTH + 1))).toBe(false);
    const atCeiling = `<div>{{ ${'a'.repeat(MAX_MERGE_TAG_LENGTH)} }}</div>`;
    expect(canonical(atCeiling)).toBe(atCeiling);
    expect(canonical(`<div>{{${'a'.repeat(MAX_MERGE_TAG_LENGTH)}}}</div>`)).toBe(atCeiling);
    expect(tokens(parseHTML(atCeiling, schema))).toBe(1);
    const runaway = `<div>{{${'a'.repeat(MAX_MERGE_TAG_LENGTH + 1)}}}</div>`;
    expect(tokens(parseHTML(runaway, schema))).toBe(0);
  });

  it('the source-pane lint masks a long token instead of reporting it as an unbroken run', () => {
    expect(lintHTML(`<div>${LONGER}</div>`)).toEqual([]);
  });
});

describe('merge-tag editing — text with a mark', () => {
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

  const type = (text: string) =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText(text));
      return true;
    });
  const cursor = (pos: number) =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, pos)));
      return true;
    });
  const select = (from: number, to: number) =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
      return true;
    });

  it('insertMergeTag inserts a token that serializes to the raw text', () => {
    expect(editor.commands['insertMergeTag']('firstName')).toBe(true);
    expect(editor.getHTML()).toBe('<div>{{ firstName }}</div>');
    expect(editor.getText()).toContain('{{ firstName }}');
    expect(marked(editor.state.doc)).toBe(true);
  });

  it('refuses an invalid path — the registry cannot inject syntax', () => {
    expect(editor.commands['insertMergeTag']('not a path')).toBe(false);
    expect(editor.commands['insertMergeTag']('{{ nested }}')).toBe(false);
    expect(editor.getHTML()).not.toContain('{{');
  });

  it('pads a completed token canonically, and leaves the one under the cursor alone', () => {
    type('x {{a}} y');
    expect(editor.getHTML()).toBe('<div>x {{ a }} y</div>');
    // Editing inside: the padding is not fought while the cursor is in there.
    cursor(5); // right after "{{"
    type('  ');
    expect(editor.getHTML()).toBe('<div>x {{   a }} y</div>');
    cursor(1); // leave the token
    type('z');
    expect(editor.getHTML()).toBe('<div>zx {{ a }} y</div>');
    // Handlebars' whitespace control keeps its sigil against the braces.
    expect(canonical('<div>{{~ foo ~}} {{&amp;raw}}</div>')).toBe('<div>{{~ foo ~}} {{&amp;raw}}</div>');
  });

  it('typing the closing brace makes the token a pill; deleting a brace un-pills it', () => {
    type('Hi {{firstName}');
    expect(tokens(editor.state.doc)).toBe(0);
    type('}');
    expect(editor.getHTML()).toBe('<div>Hi {{ firstName }}</div>');
    expect(tokens(editor.state.doc)).toBe(1);
    expect(marked(editor.state.doc)).toBe(true);
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.delete(state.selection.from - 1, state.selection.from));
      return true;
    });
    expect(editor.getHTML()).toBe('<div>Hi {{ firstName }</div>');
    expect(tokens(editor.state.doc)).toBe(0);
    expect(editor.state.doc.rangeHasMark(1, editor.state.doc.content.size - 1, schema.marks['mergeTag'])).toBe(false);
  });

  it('the cursor goes inside and edits the expression like text', () => {
    type('{{ first }}');
    // <div>(0) { { ␣ f i r s t ␣ } } → after "first" is position 9.
    cursor(9);
    type('Name');
    expect(editor.getHTML()).toBe('<div>{{ firstName }}</div>');
    expect(tokens(editor.state.doc)).toBe(1);
    expect(marked(editor.state.doc)).toBe(true);
    expect(selectionInsideMergeTag(editor.state)).toBe(true);
  });

  it('typing right after the closing braces continues as plain text', () => {
    type('{{ a }}');
    type(' and more');
    expect(editor.getHTML()).toBe('<div>{{ a }} and more</div>');
    expect(mergeTagRanges(editor.state.doc)).toEqual([{ from: 1, to: 8, expr: ' a ' }]);
    expect(selectionInsideMergeTag(editor.state)).toBe(false);
  });

  it('Ctrl-B with the cursor inside bolds the whole token — and again un-bolds it whole', () => {
    type('Dear {{ name }}, hi');
    // "Dear " = 5 chars → token spans 6..16; cursor inside at 9.
    cursor(9);
    expect(editor.commands['toggleBold']()).toBe(true);
    expect(editor.getHTML()).toBe(
      '<div>Dear <strong style="font-weight: bold;">{{ name }}</strong>, hi</div>',
    );
    expect(editor.commands['toggleBold']()).toBe(true);
    expect(editor.getHTML()).toBe('<div>Dear {{ name }}, hi</div>');
  });

  it('a whole-token bold reaches onUpdate — the html signal never falls behind the editor', () => {
    const updates: string[] = [];
    const own = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>Dear {{ name }}, hi</div>',
      onUpdate: (e) => updates.push(e.getHTML()),
    });
    own.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, 9)));
      return true;
    });
    // The toggle itself only sets stored marks; the appended transaction
    // changes the document — and that must publish.
    expect(own.commands['toggleBold']()).toBe(true);
    expect(updates.at(-1)).toBe(
      '<div>Dear <strong style="font-weight: bold;">{{ name }}</strong>, hi</div>',
    );
    own.destroy();
  });

  it('a mark applied over part of a token widens to the whole token', () => {
    type('Dear {{ name }}, hi');
    select(3, 9); // "ar {{na" — half the token
    expect(editor.commands['toggleBold']()).toBe(true);
    expect(editor.getHTML()).toBe(
      '<div>De<strong style="font-weight: bold;">ar {{ name }}</strong>, hi</div>',
    );
    // Removing over half removes from the whole token too.
    select(8, 12);
    expect(editor.commands['toggleBold']()).toBe(true);
    expect(editor.getHTML()).toBe(
      '<div>De<strong style="font-weight: bold;">ar </strong>{{ name }}, hi</div>',
    );
  });

  it('two adjacent tokens stay two tokens and re-validate without churn', () => {
    type('{{ a }}{{ b }}');
    expect(mergeTagRanges(editor.state.doc).map((t) => t.expr.trim())).toEqual(['a', 'b']);
    const before = editor.state.doc;
    type('!');
    expect(mergeTagRanges(editor.state.doc).map((t) => t.expr.trim())).toEqual(['a', 'b']);
    expect(editor.state.doc.eq(before)).toBe(false);
    expect(editor.getHTML()).toBe('<div>{{ a }}{{ b }}!</div>');
  });
});
