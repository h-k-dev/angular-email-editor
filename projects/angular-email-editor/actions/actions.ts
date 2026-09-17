import { Injector, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { EditorState } from 'prosemirror-state';
import { Editor, EditorAction, isActionEnabled } from 'angular-email-editor';

/**
 * An editor's state as a signal: the text, the selection, the stored marks —
 * whatever changed, the signal has the new one. It follows the editor it is
 * given, so handing it "the source pane in code view, the email editor
 * otherwise" is one `computed`; `undefined` while there is none.
 *
 * It listens through `editor.subscribe`, so the editor can already exist:
 * nothing has to be in the kit before the editor is made.
 *
 * Call in an injection context, or hand it an injector.
 */
export function editorState(
  editor: () => Editor | undefined,
  options: { injector?: Injector } = {},
): Signal<EditorState | undefined> {
  const state = signal<EditorState | undefined>(undefined);
  effect(
    (onCleanup) => {
      const current = editor();
      state.set(current?.state);
      if (current) onCleanup(current.subscribe(() => state.set(current.state)));
    },
    { injector: options.injector },
  );
  return state.asReadonly();
}

/**
 * An action of the host's own: something that opens its UI — a link dialog,
 * a colour or table picker — rather than running a command. It has a `run`,
 * not a `command`, on purpose: a command is *asked* whether it would apply
 * (called without a dispatch), and a function that opens a dialog must never
 * be called to ask.
 *
 * Two ways in, by what it is:
 * - `host` — an action of its own, there for every editor: "Link", which
 *   no extension can offer because it needs the host's dialog;
 * - `override` — the host's `run` *over* an action the kit declares, by its
 *   id: a toolbar's "Insert table" that opens a size picker instead of
 *   inserting one. It exists only where the kit's action does (so not in a
 *   code view), and what it leaves out — when it is on, whether it can run —
 *   is still the extension's answer.
 */
export interface HostAction {
  id: string;
  /** What triggering it does. Focus is the host's from here on: the caret
      is not sent back to the editor after it. */
  run: () => void;
  /** On at the selection — makes it a toggle. */
  isActive?: (state: EditorState) => boolean;
  /** Can run right now. Absent: the extension action's answer when it
      stands over one, else yes. */
  isEnabled?: (state: EditorState) => boolean;
}

/** An action bound to a live editor: what a button needs. */
export interface BoundAction {
  /** The action as its extension declared it — id, title, icon, keywords;
      `undefined` for a {@link HostAction} that stands alone. */
  readonly action: EditorAction | undefined;
  readonly id: string;
  /** It is the host's `run`: what happens after — where focus goes — is the
      host's too. */
  readonly external: boolean;
  /** On at the selection. Always false for an action with no "on". */
  readonly pressed: Signal<boolean>;
  /** Whether it is a toggle at all — whether `pressed` means anything. */
  readonly toggles: boolean;
  /** Cannot run right now. */
  readonly disabled: Signal<boolean>;
  /** Runs it on the editor; false when it did not apply. */
  run(): boolean;
  /** Puts the caret back in the editor it acts on. */
  focus(): void;
}

/** The actions of the editor being watched. */
export interface EditorActions {
  /** The action of that id — `undefined` while there is no editor, and when
      the editor's kit has no such action: a button for it has nothing to do.
      Reactive: it follows the editor. */
  get(id: string): BoundAction | undefined;
  /** Every action of the current editor, in kit order. */
  readonly all: Signal<readonly BoundAction[]>;
  /** The watched editor's state. */
  readonly state: Signal<EditorState | undefined>;
}

/**
 * The actions of an editor, bound and live — for a toolbar, a bubble menu,
 * a menu:
 *
 *     readonly actions = injectActions(() => this.editor());
 *
 *     <button [emailAction]="actions.get('bold')">…</button>
 *
 * `editor` is read reactively: when it changes — a composer switching to its
 * code view — the actions are the new editor's. Its kit decides what exists:
 * the source pane offers the marks, so there a list button has no action
 * and shows disabled, with no routing written anywhere.
 *
 * `host` and `override` bring in the host's own — see {@link HostAction} — so
 * that one list serves a surface whose buttons are not all the editor's.
 *
 * Call in an injection context, or hand it an injector.
 */
export function injectActions(
  editor: () => Editor | undefined,
  options: {
    host?: readonly HostAction[];
    override?: Readonly<Record<string, Omit<HostAction, 'id'>>>;
    injector?: Injector;
  } = {},
): EditorActions {
  const injector = options.injector ?? inject(Injector);
  const state = editorState(editor, { injector });

  const bind = (current: Editor, action?: EditorAction, over?: HostAction): BoundAction => {
    const isActive = over?.isActive ?? action?.isActive;
    const isEnabled = (now: EditorState) =>
      over?.isEnabled ? over.isEnabled(now) : action ? isActionEnabled(action, now) : true;
    return {
      action,
      id: (over ?? action)!.id,
      external: !!over,
      toggles: !!isActive,
      pressed: computed(() => {
        const now = state();
        return !!now && !!isActive?.(now);
      }),
      disabled: computed(() => {
        const now = state();
        return !now || !isEnabled(now);
      }),
      run: () => {
        if (!over) return current.exec(action!.command);
        over.run();
        return true;
      },
      focus: () => current.focus(),
    };
  };

  const bound = computed(() => {
    const current = editor();
    const byId = new Map<string, BoundAction>();
    // Binding reads no state: only the editor decides which actions exist.
    if (!current) return byId;
    const hosted = new Map((options.host ?? []).map((over) => [over.id, over]));
    for (const action of current.actions) {
      const given = options.override?.[action.id];
      // A host action under a kit's id is an override by another name.
      const over = given ? { id: action.id, ...given } : hosted.get(action.id);
      hosted.delete(action.id);
      byId.set(
        action.id,
        untracked(() => bind(current, action, over)),
      );
    }
    // What stands alone comes after the kit's own, in the order given.
    for (const over of hosted.values()) {
      byId.set(
        over.id,
        untracked(() => bind(current, undefined, over)),
      );
    }
    return byId;
  });

  return {
    get: (id) => bound().get(id),
    all: computed(() => [...bound().values()]),
    state,
  };
}
