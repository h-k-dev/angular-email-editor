import { Command, EditorState, Selection, Transaction } from 'prosemirror-state';

/** Whether every plugin of `state` lets `tr` through — what applying it
    would ask (`filterTransaction`), without applying it. */
export function accepted(state: EditorState, tr: Transaction): boolean {
  return state.plugins.every(
    (plugin) =>
      !plugin.spec.filterTransaction || plugin.spec.filterTransaction.call(plugin, tr, state),
  );
}

/**
 * The caret's line, where it is an empty `<p>` kept as the source wrote it
 * (`<p></p>`: no line in a mail client, so it is not the composer's own
 * line — see `trailing-break-line.ts`), as a transaction that makes it one:
 * a paragraph, its alignment carried over. Null anywhere else.
 */
function asOwnLine(state: EditorState): Transaction | null {
  const { $from, empty } = state.selection;
  const line = $from.parent;
  const paragraph = state.schema.nodes['paragraph'];
  if (
    !empty ||
    !paragraph ||
    line.type.name !== 'htmlTextElement' ||
    line.attrs['tag'] !== 'p' ||
    line.content.size
  ) {
    return null;
  }
  const style =
    (line.attrs['attrs'] as readonly (readonly [string, string])[] | undefined)?.find(
      ([name]) => name.toLowerCase() === 'style',
    )?.[1] ?? '';
  const align = /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\b/i.exec(style)?.[1];
  const attrs = align && paragraph.spec.attrs?.['align'] ? { align: align.toLowerCase() } : null;
  return state.tr.setNodeMarkup($from.before(), paragraph, attrs);
}

/** `command` on `state`: the transaction it builds, `true` where it runs
    without one, `false` where it does not run or a plugin refuses it. */
function build(command: Command, state: EditorState, view?: Parameters<Command>[2]) {
  let built: Transaction | undefined;
  if (!command(state, (tr) => (built = tr), view)) return false;
  if (!built) return true;
  return accepted(state, built) ? built : false;
}

/**
 * `command`, answering for the transaction it would dispatch as well as for
 * itself: where a plugin refuses that transaction (a static layout block's
 * lock, `LayoutInteraction`), the command cannot run — so a dry run says
 * `false`, its button shows disabled, and its key falls through, instead of
 * a control that looks ready and does nothing.
 *
 * **From an empty `<p>` kept as written.** Such a paragraph is not the
 * composer's own line, and a block command (a heading, a list) has nothing
 * to turn there: it would be refused, the button dead on what looks like an
 * empty line. Where the command does not run as it stands, the `<p>` is
 * made the composer's line first and the command run on that — both in the
 * one transaction, one undo. The email changes only as its writer asks for
 * a block there; a `<p></p>` nobody touches stays as written.
 *
 * Only for a command that does nothing but build its transaction: it is run
 * with a dispatch of its own on a dry run too.
 */
export const guarded =
  (command: Command): Command =>
  (state, dispatch, view) => {
    const built = build(command, state, view);
    if (built !== false) {
      if (built !== true) dispatch?.(built);
      return true;
    }

    const own = asOwnLine(state);
    if (!own || !accepted(state, own)) return false;
    const line = state.apply(own);
    // Something answered the change with one of its own: not ours to merge.
    if (!line.doc.eq(own.doc)) return false;
    const then = build(command, line, view);
    if (then === false) return false;
    if (!dispatch) return true;
    if (then === true) {
      dispatch(own);
      return true;
    }
    const tr = state.tr;
    for (const step of [...own.steps, ...then.steps]) tr.step(step);
    tr.setSelection(Selection.fromJSON(tr.doc, then.selection.toJSON()));
    if (then.storedMarksSet) tr.setStoredMarks(then.storedMarks);
    if (then.scrolledIntoView) tr.scrollIntoView();
    dispatch(tr);
    return true;
  };
