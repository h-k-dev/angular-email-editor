import { createEditor, Editor } from '../../editor';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { lintHTML } from '../../html-source';
import { parseDocument } from '../../envelope';
import { emailPlainText } from '../../plain-text';
import Handlebars from 'handlebars';
import { TextSelection } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { emailExtensions } from '../kits';
import {
  MAX_MERGE_TAG_LENGTH,
  canonicalMergeTagInner,
  decodeMergeTagEntities,
  isMergeTagExpression,
  mergeTagFields,
  mergeTagRanges,
  restoreMergeTagsIn,
  selectionInsideMergeTag,
  standInMergeTags,
  writeMergeTags,
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
    const doc = parseHTML(bold, schema);
    expect(tokens(doc)).toBe(1);
    expect(marked(doc)).toBe(true);
    let boldText = '';
    doc.descendants((node) => {
      if (node.isText && schema.marks['bold'].isInSet(node.marks)) boldText += node.text;
    });
    expect(boldText).toBe('Hi {{ firstName }}');
    expect(canonical(bold)).toBe(bold);
  });

  it('a token split by formatting is no merge tag — text as written, never widened', () => {
    const split = '<div><b>{{ first</b>Name }} x</div>';
    expect(canonical(split)).toBe(split);
    const doc = parseHTML(split, schema);
    let pills = 0;
    doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === 'mergeTag')) pills++;
    });
    expect(pills).toBe(0);
    expect(mergeTagRanges(doc)).toEqual([]);
    // Not respaced either: `{{first` stays as typed.
    expect(canonical('<div><b>{{first</b>Name}}</div>')).toBe('<div><b>{{first</b>Name}}</div>');
  });

  it('a token one formatting covers whole is a merge tag — bold as a whole', () => {
    const doc = parseHTML('<div><b>{{ firstName }}</b> x</div>', schema);
    expect(mergeTagRanges(doc).map((tag) => tag.expr)).toEqual([' firstName ']);
    expect(canonical('<div><b>{{ firstName }}</b> x</div>')).toBe(
      '<div><b>{{ firstName }}</b> x</div>',
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
    expect(canonical('<div>{{~ foo ~}} {{&amp;raw}}</div>')).toBe(
      '<div>{{~ foo ~}} {{&amp;raw}}</div>',
    );
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
    expect(
      editor.state.doc.rangeHasMark(1, editor.state.doc.content.size - 1, schema.marks['mergeTag']),
    ).toBe(false);
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

describe('merge-tag — written as typed, read whole', () => {
  const badge = '<div class="cs" style="{{case_private || cf_20 ? "" : "display:none"}}">x</div>';

  it('pads a token, and hands its expression to the dialect — a sigil kept against its braces', () => {
    const upper = (expr: string) => expr.toUpperCase();
    expect(canonicalMergeTagInner('a', upper)).toBe(' A ');
    expect(canonicalMergeTagInner('  a  ')).toBe(' a ');
    expect(canonicalMergeTagInner('~ a ~', upper)).toBe('~ a ~');
  });

  it('writes a token as typed, where HTML still reads it as text', () => {
    expect(writeMergeTags('<p>{{ cf_3 &gt; 0 &amp;&amp; cf_4 &lt; 2 }}</p>')).toBe('<p>{{ cf_3 > 0 && cf_4 < 2 }}</p>');
    // `&` before a name, `<` before a tag's: still escaped.
    expect(writeMergeTags('{{ a &amp;b; }} {{ a &lt;b }}')).toBe('{{ a &amp;b; }} {{ a &lt;b }}');
    // Outside a token, and a token holding markup: as it is.
    expect(writeMergeTags('a &amp;&amp; b {{ a <b>&amp;</b> }}')).toBe('a &amp;&amp; b {{ a <b>&amp;</b> }}');
  });

  it('serializes a token as typed', () => {
    expect(canonical('<div>{{ cf_3 &gt; 0 &amp;&amp; cf_4 }}</div>')).toBe('<div>{{ cf_3 > 0 && cf_4 }}</div>');
  });

  it('decodes the references a token holds, by hand — no document needed', () => {
    expect(decodeMergeTagEntities('&quot;&#252;&#xE4;&amp;&nope;&#0;')).toBe('"üä&&nope;&#0;');
  });

  it('stands a token in for a word of its own width, and puts it back into the tree', () => {
    const { html, tags } = standInMergeTags(badge);
    expect(html).not.toContain('{{');
    expect(html.length).toBe(badge.length);

    const body = new DOMParser().parseFromString(`<body>${html}<!-- {{ c }} -->`, 'text/html').body;
    restoreMergeTagsIn(body, tags);
    expect(body.firstElementChild?.getAttribute('style')).toBe('{{case_private || cf_20 ? "" : "display:none"}}');
  });

  it('puts tokens back into comments too', () => {
    const { html, tags } = standInMergeTags('<!-- {{ a }} --><p>{{ b }}</p>');
    const body = new DOMParser().parseFromString(`<body>${html}`, 'text/html').body;
    restoreMergeTagsIn(body, tags);
    expect(body.innerHTML).toBe('<!-- {{ a }} --><p>{{ b }}</p>');
  });

  it('never stands in a token holding markup, nor reads a look-alike as a token', () => {
    expect(standInMergeTags('{{ <b>x</b> }}').html).toBe('{{ <b>x</b> }}');
    const lookAlike = '<a href="\ue000\ue010\ue002">{{ x }}</a>';
    expect(standInMergeTags(lookAlike)).toEqual({ html: lookAlike, tags: [] });
  });

  it('parses a token in an attribute whole, its quotes the attribute text', () => {
    const div = parseDocument(badge).body.firstElementChild;
    expect(div?.getAttribute('style')).toBe('{{case_private || cf_20 ? "" : "display:none"}}');
    expect(div?.getAttributeNames()).toEqual(['class', 'style']);
  });

  it('stays linear on hostile input — tokens, references, stand-ins', () => {
    const hostile = [
      ('{{ ' + 'a'.repeat(1000)).repeat(60),
      ('&' + 'a'.repeat(40)).repeat(1500),
      '{{ ' + '&amp;'.repeat(150) + ' }}',
    ].join('');
    const started = performance.now();
    standInMergeTags(hostile);
    writeMergeTags(hostile);
    decodeMergeTagEntities(hostile);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
