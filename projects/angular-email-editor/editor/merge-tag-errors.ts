import type { FieldTree, ValidationError } from '@angular/forms/signals';
import type { EditorState } from 'prosemirror-state';
import { distinctMergeTagExpressions } from '@h-k-dev/angular-email-editor';

/** The kind of {@link MergeTagUnfilled}. */
export const MERGE_TAG_UNFILLED = 'mergeTag.unfilled';

/**
 * A placeholder the evaluator has no value for — an error on the body
 * field naming its token, so the body's control puts the caret on it when
 * the form focuses the field (`focusBoundControl`): `[emailEditor]` reads
 * its `errors` and selects the token ({@link EmailEditor.focus}).
 */
export interface MergeTagUnfilled extends ValidationError {
  readonly kind: typeof MERGE_TAG_UNFILLED;
  /** The expression, trimmed — `customer.lastName`. */
  readonly expr: string;
}

export const isMergeTagUnfilled = (error: ValidationError): error is MergeTagUnfilled =>
  error.kind === MERGE_TAG_UNFILLED &&
  typeof (error as Partial<MergeTagUnfilled>).expr === 'string';

/** Whatever holds the document: `[emailEditor]` (its `editor()`), or any
    host exposing the editor the same way. */
export interface MergeTagDocument {
  editor(): { readonly state: EditorState } | undefined;
}

export interface CheckMergeTagValuesOptions {
  /** The host's evaluator — the same one `createMergeTagResolution` takes:
      a value per expression, in order; `''`, `null` or `undefined` is no
      value. */
  resolve: (expressions: string[]) => Promise<readonly (string | null | undefined)[]>;
  /** The error's words. Default: `No value for {{ expr }}`. */
  message?: (expr: string) => string;
}

/**
 * The send-time check, for a form's submission action: asks `resolve` for
 * every placeholder in the document (running text and attributes, each
 * expression once) and returns an error on `field` for each one without a
 * value, in reading order — none when every one has a value.
 *
 *     submission: {
 *       action: async (form) => {
 *         const unfilled = await checkMergeTagValues(form.html, this.editor(), { resolve });
 *         if (unfilled.length) return unfilled;
 *         …send…
 *       },
 *       onInvalid: (form) => form().errorSummary()[0]?.fieldTree().focusBoundControl(),
 *     }
 *
 * Errors returned from an action land once it settles; focus the field
 * after that (`afterNextRender`) to put the caret on the first token. Any
 * edit to the body clears them (submission errors follow the value), and
 * the next send asks again — the next token, if any, is next.
 */
export async function checkMergeTagValues(
  field: FieldTree<string>,
  document: MergeTagDocument | undefined,
  options: CheckMergeTagValuesOptions,
): Promise<(MergeTagUnfilled & { readonly fieldTree: FieldTree<string> })[]> {
  const state = document?.editor()?.state;
  const expressions = state ? distinctMergeTagExpressions(state.doc) : [];
  if (!expressions.length) return [];
  const values = await options.resolve(expressions);
  const message = options.message ?? ((expr: string) => `No value for {{ ${expr} }}`);
  return expressions
    .filter((_, i) => !values[i])
    .map((expr) => ({ kind: MERGE_TAG_UNFILLED, expr, message: message(expr), fieldTree: field }));
}
