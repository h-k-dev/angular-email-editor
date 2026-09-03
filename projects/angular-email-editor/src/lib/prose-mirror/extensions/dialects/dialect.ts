import { Node } from 'prosemirror-model';
import { EditorState, PluginKey } from 'prosemirror-state';

/**
 * An *expression dialect*: what the `{{…}}` tokens mean. The merge-tag mark
 * is dialect-neutral — it finds tokens, keeps the pill honest and formats
 * them whole — and a dialect layers meaning on top, opt-in, one per editor:
 * a parser for the token language, exact required fields from the parse,
 * syntax diagnostics before the template ever reaches a renderer. The first
 * dialect is AngularJS expressions (`createAngularExpressions`); Handlebars
 * follows. Without a dialect the generic lexer in `mergeTagFields` stands in.
 */
export interface ExpressionDialect {
  /** A short name, e.g. `angular`. */
  readonly name: string;
  /** The identifiers the document's tokens read — the values the host must
      supply — deduplicated, in first-use order. */
  requiredFields(doc: Node): string[];
  /** Diagnostics for one token's inner expression, positions relative to it. */
  analyze(expr: string): ExpressionIssue[];
}

/** A problem inside one expression, `[from, to)` relative to its text. */
export interface ExpressionIssue {
  from: number;
  to: number;
  message: string;
}

/** A problem in the document: a token's issue at document positions. */
export interface ExpressionDiagnostic extends ExpressionIssue {
  /** The token's inner expression, verbatim. */
  expr: string;
}

/** The dialect installed on an editor, as plugin state, so the send intent
    and the host read the one the editor was configured with. */
export const expressionDialectKey = new PluginKey<{ dialect: ExpressionDialect }>(
  'expressionDialect',
);

export const expressionDialect = (state: EditorState): ExpressionDialect | undefined =>
  expressionDialectKey.getState(state)?.dialect;
