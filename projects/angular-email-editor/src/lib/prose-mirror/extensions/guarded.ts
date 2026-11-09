import { Command, EditorState, Transaction } from 'prosemirror-state';

/** Whether every plugin of `state` lets `tr` through — what applying it
    would ask (`filterTransaction`), without applying it. */
export function accepted(state: EditorState, tr: Transaction): boolean {
  return state.plugins.every(
    (plugin) =>
      !plugin.spec.filterTransaction || plugin.spec.filterTransaction.call(plugin, tr, state),
  );
}

/**
 * `command`, answering for the transaction it would dispatch as well as for
 * itself: where a plugin refuses that transaction (a static layout block's
 * lock, `LayoutInteraction`), the command cannot run — so a dry run says
 * `false`, its button shows disabled, and its key falls through, instead of
 * a control that looks ready and does nothing.
 *
 * Only for a command that does nothing but build its transaction: it is run
 * with a dispatch of its own on a dry run too.
 */
export const guarded =
  (command: Command): Command =>
  (state, dispatch, view) => {
    let built: Transaction | undefined;
    if (!command(state, (tr) => (built = tr), view)) return false;
    if (!built) return true;
    if (!accepted(state, built)) return false;
    dispatch?.(built);
    return true;
  };
