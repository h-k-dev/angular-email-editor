import { Node } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../../extension';
import { mergeTagRanges } from '../nodes/merge-tag';
import {
  ExpressionDialect,
  ExpressionDiagnostic,
  ExpressionIssue,
  expressionDialectKey,
} from './dialect';

/**
 * The AngularJS expression dialect — `$parse`'s grammar, opt-in
 * (`createAngularExpressions`): literals, identifiers, member access,
 * calls, unary/binary operators, the ternary, filters with `:` arguments,
 * assignments and `;` statements. A hand-written recursive-descent parser
 * over one token's text; from the parse follow the two things the editor
 * needs and the heuristic lexer could only approximate:
 *
 *  - **Syntax diagnostics** — an unbalanced quote or paren, a dangling `?`,
 *    a stray character — positioned inside the token, surfaced as
 *    underlines in the editor and as errors to the host, *before* the
 *    template reaches a renderer where it would fail silently.
 *  - **Exact required fields** — every identifier read as a value: the root
 *    of a member chain (`customer.name` → `customer`), both sides of a
 *    computed member (`rows[idx]` → `rows`, `idx`), arguments of calls and
 *    filters; never a bare callee (`round(…)` is a helper), a filter name,
 *    a property tail, a literal, or a local assigned anywhere in the
 *    document (`mwst = …; mwst`).
 *
 * The parser recognises; it never evaluates (that is a later slice, for a
 * preview with sample data) and never rewrites: the token text stays
 * byte-verbatim, as the merge-tag mark guarantees.
 */

// ---------------------------------------------------------------------------
// Tokens

type TokenKind = 'identifier' | 'number' | 'string' | 'operator' | 'end';

interface Token {
  kind: TokenKind;
  text: string;
  from: number;
  to: number;
}

const OPERATORS = [
  '===',
  '!==',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
  '=',
  '<',
  '>',
  '?',
  ':',
  '|',
  ';',
  ',',
  '.',
  '(',
  ')',
  '[',
  ']',
];

class ExpressionError extends Error {
  constructor(
    message: string,
    readonly from: number,
    readonly to: number,
  ) {
    super(message);
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))!;
      tokens.push({ kind: 'identifier', text: match[0], from: i, to: i + match[0].length });
      i += match[0].length;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i))!;
      tokens.push({ kind: 'number', text: match[0], from: i, to: i + match[0].length });
      i += match[0].length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1;
      if (j >= source.length) throw new ExpressionError('Unterminated string', i, source.length);
      tokens.push({ kind: 'string', text: source.slice(i, j + 1), from: i, to: j + 1 });
      i = j + 1;
      continue;
    }
    const operator = OPERATORS.find((op) => source.startsWith(op, i));
    if (operator) {
      tokens.push({ kind: 'operator', text: operator, from: i, to: i + operator.length });
      i += operator.length;
      continue;
    }
    throw new ExpressionError(`Unexpected character '${ch}'`, i, i + 1);
  }
  tokens.push({ kind: 'end', text: '', from: source.length, to: source.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// Syntax tree

export type AngularNode =
  | { type: 'Literal'; value: string | number | boolean | null | undefined }
  | { type: 'Identifier'; name: string }
  | { type: 'Member'; object: AngularNode; property: AngularNode; computed: boolean }
  | { type: 'Call'; callee: AngularNode; args: AngularNode[] }
  | { type: 'Unary'; operator: string; argument: AngularNode }
  | { type: 'Binary'; operator: string; left: AngularNode; right: AngularNode }
  | { type: 'Conditional'; test: AngularNode; consequent: AngularNode; alternate: AngularNode }
  | { type: 'Assignment'; target: AngularNode; value: AngularNode }
  | { type: 'Filter'; name: string; input: AngularNode; args: AngularNode[] }
  | { type: 'Array'; elements: AngularNode[] }
  | { type: 'Program'; statements: AngularNode[] };

const LITERALS: Record<string, string | number | boolean | null | undefined> = {
  true: true,
  false: false,
  null: null,
  undefined: undefined,
};

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  private get token(): Token {
    return this.tokens[this.index];
  }

  // A method, not a narrowed property read: the index moves under it.
  private atEnd(): boolean {
    return this.tokens[this.index].kind === 'end';
  }

  private is(text: string): boolean {
    return this.token.kind === 'operator' && this.token.text === text;
  }

  private eat(text: string): boolean {
    if (!this.is(text)) return false;
    this.index++;
    return true;
  }

  private expect(text: string): void {
    if (!this.eat(text)) this.fail(`Expected '${text}'`);
  }

  /** A specific expectation wins even at the end of the input ("Expected
      ')'" beats "Unexpected end"); without one, the end is the message. */
  private fail(message?: string): never {
    const token = this.token;
    if (message) throw new ExpressionError(message, token.from, token.to);
    if (token.kind === 'end') {
      throw new ExpressionError('Unexpected end of expression', token.from, token.to);
    }
    throw new ExpressionError(`Unexpected token '${token.text}'`, token.from, token.to);
  }

  program(): AngularNode {
    const statements: AngularNode[] = [];
    while (true) {
      if (this.atEnd() || this.is(';')) {
        if (!this.eat(';')) break;
        continue;
      }
      statements.push(this.filterChain());
      if (this.atEnd()) break;
      if (!this.is(';')) this.fail();
    }
    if (!statements.length) throw new ExpressionError('Empty expression', 0, 0);
    return { type: 'Program', statements };
  }

  private filterChain(): AngularNode {
    let left = this.expression();
    while (this.eat('|')) {
      if (this.token.kind !== 'identifier') this.fail('Expected a filter name');
      const name = this.token.text;
      this.index++;
      const args: AngularNode[] = [];
      while (this.eat(':')) args.push(this.expression());
      left = { type: 'Filter', name, input: left, args };
    }
    return left;
  }

  private expression(): AngularNode {
    return this.assignment();
  }

  private assignment(): AngularNode {
    const target = this.ternary();
    if (this.is('=')) {
      if (target.type !== 'Identifier' && target.type !== 'Member') {
        this.fail('Cannot assign to this expression');
      }
      this.index++;
      return { type: 'Assignment', target, value: this.assignment() };
    }
    return target;
  }

  private ternary(): AngularNode {
    const test = this.logicalOr();
    if (this.eat('?')) {
      const consequent = this.expression();
      this.expect(':');
      const alternate = this.expression();
      return { type: 'Conditional', test, consequent, alternate };
    }
    return test;
  }

  private binary(next: () => AngularNode, operators: string[]): AngularNode {
    let left = next();
    for (;;) {
      const operator = operators.find((op) => this.is(op));
      if (!operator) return left;
      this.index++;
      left = { type: 'Binary', operator, left, right: next() };
    }
  }

  private logicalOr = (): AngularNode => this.binary(this.logicalAnd, ['||']);
  private logicalAnd = (): AngularNode => this.binary(this.equality, ['&&']);
  private equality = (): AngularNode =>
    this.binary(this.relational, ['===', '!==', '==', '!=']);
  private relational = (): AngularNode => this.binary(this.additive, ['<=', '>=', '<', '>']);
  private additive = (): AngularNode => this.binary(this.multiplicative, ['+', '-']);
  private multiplicative = (): AngularNode => this.binary(this.unary, ['*', '/', '%']);

  private unary = (): AngularNode => {
    for (const operator of ['+', '-', '!']) {
      if (this.eat(operator)) return { type: 'Unary', operator, argument: this.unary() };
    }
    return this.postfix();
  };

  private postfix(): AngularNode {
    let node = this.primary();
    for (;;) {
      if (this.eat('.')) {
        if (this.token.kind !== 'identifier') this.fail('Expected a property name');
        node = {
          type: 'Member',
          object: node,
          property: { type: 'Identifier', name: this.token.text },
          computed: false,
        };
        this.index++;
      } else if (this.eat('[')) {
        const property = this.expression();
        this.expect(']');
        node = { type: 'Member', object: node, property, computed: true };
      } else if (this.eat('(')) {
        const args: AngularNode[] = [];
        if (!this.is(')')) {
          do args.push(this.expression());
          while (this.eat(','));
        }
        this.expect(')');
        node = { type: 'Call', callee: node, args };
      } else {
        return node;
      }
    }
  }

  private primary(): AngularNode {
    const token = this.token;
    if (this.eat('(')) {
      const inner = this.filterChain();
      this.expect(')');
      return inner;
    }
    if (this.eat('[')) {
      const elements: AngularNode[] = [];
      if (!this.is(']')) {
        do elements.push(this.expression());
        while (this.eat(','));
      }
      this.expect(']');
      return { type: 'Array', elements };
    }
    if (token.kind === 'number') {
      this.index++;
      return { type: 'Literal', value: Number(token.text) };
    }
    if (token.kind === 'string') {
      this.index++;
      return { type: 'Literal', value: token.text.slice(1, -1) };
    }
    if (token.kind === 'identifier') {
      this.index++;
      if (token.text in LITERALS) return { type: 'Literal', value: LITERALS[token.text] };
      return { type: 'Identifier', name: token.text };
    }
    return this.fail();
  }
}

/** Parses one token's inner expression. Throws an {@link ExpressionError}
    (message + position) on the first problem. */
export function parseAngularExpression(expr: string): AngularNode {
  return new Parser(tokenize(expr)).program();
}

/** The parse's verdict on one expression: its issues (at most one — the
    first — today), empty when it is a valid program. */
export function analyzeAngularExpression(expr: string): ExpressionIssue[] {
  try {
    parseAngularExpression(expr);
    return [];
  } catch (error) {
    if (error instanceof ExpressionError) {
      return [{ from: error.from, to: error.to, message: error.message }];
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Required fields

/** Ambient values the evaluator provides — never fetched from the host. */
const AMBIENT = new Set(['this', 'now']);

function walk(
  node: AngularNode,
  fields: Set<string>,
  locals: Set<string>,
  context: { callee?: boolean; assignTarget?: boolean } = {},
): void {
  switch (node.type) {
    case 'Program':
      node.statements.forEach((statement) => walk(statement, fields, locals));
      break;
    case 'Identifier':
      if (context.assignTarget) locals.add(node.name);
      else if (!context.callee && !AMBIENT.has(node.name)) fields.add(node.name);
      break;
    case 'Member':
      // The root of a chain is read even when the chain is assigned to
      // (`customer.note = …` reads `customer`); a computed key is a value.
      walk(node.object, fields, locals);
      if (node.computed) walk(node.property, fields, locals);
      break;
    case 'Call':
      // A bare callee is a helper on the scope (`round(…)`), not a field; a
      // member callee reads its object (`customer.getName()`).
      walk(node.callee, fields, locals, { callee: node.callee.type === 'Identifier' });
      node.args.forEach((arg) => walk(arg, fields, locals));
      break;
    case 'Unary':
      walk(node.argument, fields, locals);
      break;
    case 'Binary':
      walk(node.left, fields, locals);
      walk(node.right, fields, locals);
      break;
    case 'Conditional':
      walk(node.test, fields, locals);
      walk(node.consequent, fields, locals);
      walk(node.alternate, fields, locals);
      break;
    case 'Assignment':
      walk(node.target, fields, locals, { assignTarget: true });
      walk(node.value, fields, locals);
      break;
    case 'Filter':
      walk(node.input, fields, locals);
      node.args.forEach((arg) => walk(arg, fields, locals));
      break;
    case 'Array':
      node.elements.forEach((element) => walk(element, fields, locals));
      break;
    case 'Literal':
      break;
  }
}

/** The required fields of a set of expressions: values read anywhere, minus
    locals assigned anywhere (an assignment is seen across all tokens), in
    first-use order. An expression that does not parse contributes nothing —
    the diagnostic says why. */
export function angularRequiredFields(expressions: string[]): string[] {
  const programs: AngularNode[] = [];
  for (const expr of expressions) {
    try {
      programs.push(parseAngularExpression(expr));
    } catch {
      // reported as a diagnostic, not a field
    }
  }
  const fields = new Set<string>();
  const locals = new Set<string>();
  for (const program of programs) walk(program, fields, locals);
  return [...fields].filter((name) => !locals.has(name));
}

// ---------------------------------------------------------------------------
// The extension

export const angularDialect: ExpressionDialect = {
  name: 'angular',
  requiredFields: (doc: Node) => angularRequiredFields(mergeTagRanges(doc).map((t) => t.expr)),
  analyze: analyzeAngularExpression,
};

export interface AngularExpressionsOptions {
  /** Called with the document's expression diagnostics whenever they change
      (an empty list when every token parses) — the host's status strip. */
  onDiagnostics?: (diagnostics: ExpressionDiagnostic[]) => void;
}

interface DialectState {
  dialect: ExpressionDialect;
  diagnostics: ExpressionDiagnostic[];
  decorations: DecorationSet;
}

function analyzeDocument(doc: Node): Omit<DialectState, 'dialect'> {
  const diagnostics: ExpressionDiagnostic[] = [];
  const decorations: Decoration[] = [];
  for (const tag of mergeTagRanges(doc)) {
    const inner = tag.from + 2; // past the opening braces
    for (const issue of analyzeAngularExpression(tag.expr)) {
      const diagnostic = { ...issue, from: inner + issue.from, to: inner + issue.to, expr: tag.expr };
      diagnostics.push(diagnostic);
      // An end-of-input problem has no width: underline the whole token.
      const [from, to] =
        issue.from === issue.to ? [tag.from, tag.to] : [diagnostic.from, diagnostic.to];
      decorations.push(
        Decoration.inline(from, to, { class: 'aee-expr-error', title: issue.message }),
      );
    }
  }
  return { diagnostics, decorations: DecorationSet.create(doc, decorations) };
}

/**
 * Installs the AngularJS dialect on an editor: the send intent's required
 * fields come from the parse, every token is checked after each change, a
 * problem is underlined in place (`.aee-expr-error`, the app owns the
 * pixels) and reported through `onDiagnostics` with document positions —
 * so a host can count it in its status strip and jump to it. Opt-in: an
 * editor without it keeps the generic lexer and no checking.
 */
export const createAngularExpressions = (
  options: AngularExpressionsOptions = {},
): FunctionalExtension =>
  defineExtension({
    name: 'angularExpressions',
    plugins: () => [
      new Plugin<DialectState>({
        key: expressionDialectKey as never,
        state: {
          init: (_config, state) => ({ dialect: angularDialect, ...analyzeDocument(state.doc) }),
          apply: (tr, value) =>
            tr.docChanged ? { dialect: angularDialect, ...analyzeDocument(tr.doc) } : value,
        },
        props: {
          decorations: (state) => expressionDialectKey.getState(state)?.['decorations' as never],
        },
        view: () => ({
          update: (view, previous) => {
            const now = (expressionDialectKey.getState(view.state) as DialectState | undefined)
              ?.diagnostics;
            const before = (expressionDialectKey.getState(previous) as DialectState | undefined)
              ?.diagnostics;
            if (now && now !== before) options.onDiagnostics?.(now);
          },
        }),
      }),
    ],
  });
