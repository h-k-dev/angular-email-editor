import { createEditor } from '../../editor';
import { createSchema } from '../../schema';
import { parseHTML } from '../../html';
import { emailExtensions } from '../kits';
import { SendIntent, createSendIntent } from '../send-intent';
import { mergeTagFields, mergeTagRanges } from '../nodes/merge-tag';
import { ExpressionDiagnostic } from './dialect';
import {
  analyzeAngularExpression,
  angularRequiredFields,
  createAngularExpressions,
  parseAngularExpression,
} from './angular-expressions';

const schema = createSchema(emailExtensions);

describe('AngularJS expression parser', () => {
  it('parses every expression the example templates use', () => {
    for (const expr of [
      "customer_gender == 'male' ? 'Herr' : 'Frau'",
      'customer_surname',
      " cf_71 ? 'JA' : 'NEIN' ",
      ' 1+2+3+4+5 ',
      ' mwst = round(parseFloat( cf_70 ) * 0.19,2); mwst ',
      'cf_70 | formatPrice',
      ' parseFloat(cf_70) + mwst ',
      " '2021-09-21' | formatDateDE ",
      " '2021-09-21' | calcDate:'+5days' | formatDateDE",
      " cf_68 | calcDate:'+4 weeks' | formatDateDE",
      'now | formatDateTimeDE',
      " round(parseFloat(cf_70) * 0.19,2) | formatPrice ",
      "customer_gender == 'male' ? 'Sehr geehrter Herr ' + customer_title + ' ' + customer_surname : customer_gender == 'female' ? 'Sehr geehrte Frau ' + customer_title + ' ' + customer_surname : customer_gender == 'diverse' ? 'Guten Tag ' + customer_firstname + ' ' + customer_surname : 'Sehr geehrte Damen und Herren'",
      "rows[idx].name || 'n/a'",
      '!(a && b) === -c',
      "[1, 'two', three]",
      'a.b.c(d, e)[f]',
      "x >= 1e3 && y <= .5 || z != \"q\\\"uote\"",
    ]) {
      expect(analyzeAngularExpression(expr)).toEqual([]);
    }
  });

  it('reports the first problem with its position', () => {
    const cases: [string, string, number, number][] = [
      ["a ? 'b'", "Expected ':'", 7, 7],
      ["'abc", 'Unterminated string', 0, 4],
      ['a +', 'Unexpected end of expression', 3, 3],
      ['a b', "Unexpected token 'b'", 2, 3],
      ['1 = 2', 'Cannot assign to this expression', 2, 3],
      ['a | ', 'Expected a filter name', 4, 4],
      ['f(a', "Expected ')'", 3, 3],
      ['a # b', "Unexpected character '#'", 2, 3],
      ['   ', 'Empty expression', 0, 0],
      ['a.', 'Expected a property name', 2, 2],
    ];
    for (const [expr, message, from, to] of cases) {
      expect(analyzeAngularExpression(expr)).toEqual([{ from, to, message }]);
    }
  });

  it('builds the tree — a filter chain wraps the expression, a ternary nests right', () => {
    const tree = parseAngularExpression("a ? b : c | f:'x'");
    expect(tree.type).toBe('Program');
    const [statement] = (tree as { statements: unknown[] }).statements as [
      { type: string; name: string; input: { type: string } },
    ];
    expect(statement.type).toBe('Filter');
    expect(statement.name).toBe('f');
    expect(statement.input.type).toBe('Conditional');
  });
});

describe('AngularJS required fields', () => {
  const fields = (...exprs: string[]) => angularRequiredFields(exprs);

  it('agrees with the generic lexer on the production template', () => {
    const exprs = [
      "customer_gender == 'male' ? 'Herr' : 'Frau'",
      'customer_surname',
      " cf_71 ? 'JA' : 'NEIN' ",
      ' mwst = round(parseFloat( cf_70 ) * 0.19, 2); mwst ',
      'parseFloat(cf_70) | formatPrice',
      'mwst | formatPrice',
      " cf_68 | calcDate:'+4 weeks' | formatDateDE",
      'now | formatDateDE',
      'doc_cf_67_storageKey',
      'case_name',
    ];
    expect(fields(...exprs)).toEqual([
      'customer_gender',
      'customer_surname',
      'cf_71',
      'cf_70',
      'cf_68',
      'doc_cf_67_storageKey',
      'case_name',
    ]);
  });

  it('gets right what the lexer could only approximate', () => {
    expect(fields('cf_70 * 1e3')).toEqual(['cf_70']); // `e3` is not a field
    expect(fields('rows[idx].name')).toEqual(['rows', 'idx']);
    expect(fields('customer.getName(prefix)')).toEqual(['customer', 'prefix']);
    expect(fields("a || b, c")).toEqual([]); // does not parse: reported, not guessed
    expect(fields('a || b')).toEqual(['a', 'b']);
    expect(fields('customer.note = draft; customer.note')).toEqual(['customer', 'draft']);
    expect(fields('x = 1', 'x + y')).toEqual(['y']); // a local assigned in another token
    expect(fields("'it\\'s ' + name")).toEqual(['name']);
  });
});

describe('createAngularExpressions', () => {
  const mount = (content: string) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reports: ExpressionDiagnostic[][] = [];
    const sent: SendIntent[] = [];
    const editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createAngularExpressions({ onDiagnostics: (d) => reports.push(d) }),
        createSendIntent({ onSend: (intent) => sent.push(intent) }),
      ],
      content,
    });
    return { editor, reports, sent, unmount: () => (editor.destroy(), host.remove()) };
  };

  it('underlines a broken token in place and reports it with document positions', () => {
    const { editor, reports, unmount } = mount("<div>Hi {{ customer ? 'x' }},</div>");
    // No report on mount (nothing changed yet); the decoration is there.
    expect(editor.view.dom.querySelector('.aee-expr-error')?.textContent).toBe(
      "{{ customer ? 'x' }}",
    );
    // Fix it: type the missing branch right before the closing braces.
    const token = mergeTagRanges(editor.state.doc)[0];
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText(" : 'y'", token.to - 3));
      return true;
    });
    expect(editor.getHTML()).toBe("<div>Hi {{ customer ? 'x' : 'y' }},</div>");
    expect(reports.at(-1)).toEqual([]);
    expect(editor.view.dom.querySelector('.aee-expr-error')).toBeNull();
    // Break it again: a stray character inside — positioned on it.
    const fixed = mergeTagRanges(editor.state.doc)[0];
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('#', fixed.from + 12));
      return true;
    });
    const [diagnostic] = reports.at(-1)!;
    expect(diagnostic.message).toBe("Unexpected character '#'");
    expect(editor.state.doc.textBetween(diagnostic.from, diagnostic.to)).toBe('#');
    expect(diagnostic.expr).toBe(" customer #? 'x' : 'y' ");
    unmount();
  });

  it('the send intent takes its required fields from the dialect', () => {
    const { editor, sent, unmount } = mount('<div>{{ cf_70 * 1e3 }} {{ rows[idx] }}</div>');
    editor.commands['requestSend']();
    expect(sent[0].requiredFields).toEqual(['cf_70', 'rows', 'idx']);
    // The generic lexer would have guessed `e3` too — the dialect knows better.
    expect(mergeTagFields(parseHTML('<div>{{ cf_70 * 1e3 }}</div>', schema))).toContain('e3');
    unmount();
  });
});
