import { Directive, computed, input } from '@angular/core';
import { Editor } from '@h-k-dev/angular-email-editor';
import { BoundAction, EMAIL_ACTIONS, EditorActions, injectActions } from './actions';

/** A list made by `injectActions`, not an editor. */
const isActions = (value: Editor | EditorActions | undefined): value is EditorActions =>
  !!value && 'all' in value;

/**
 * The actions of an editor, as a directive: put it on the element that
 * holds the host's buttons — a toolbar, a menu — and every `[emailAction]`
 * inside has its actions, by injection, with nothing to bind:
 *
 *     <div role="toolbar" [emailActions]="body.editor()" emailKeepFocus>
 *       <button emailAction="bold">B</button>
 *       <button emailAction="italic">I</button>
 *     </div>
 *     <div [emailEditor]="kit" #body="emailEditor"></div>
 *
 * It takes the editor — read reactively, so it may come later, or change —
 * or a list the host made itself, with its own actions in it
 * (`injectActions(editor, { host, override })`).
 *
 * The directive *is* the {@link EditorActions}: `#actions="emailActions"`,
 * then `actions.all()` for a toolbar that lists what the kit declares. A
 * trigger with its own `[emailActionFrom]` keeps that one.
 */
@Directive({
  selector: '[emailActions]',
  exportAs: 'emailActions',
  providers: [{ provide: EMAIL_ACTIONS, useExisting: Actions }],
})
export class Actions implements EditorActions {
  /** The editor whose actions these are, or a list of them. */
  readonly of = input.required<Editor | EditorActions | undefined>({ alias: 'emailActions' });

  /** The editor's own list — idle while a list is given. */
  readonly #own = injectActions(() => {
    const of = this.of();
    return isActions(of) ? undefined : of;
  });

  readonly #actions = computed(() => {
    const of = this.of();
    return isActions(of) ? of : this.#own;
  });

  readonly all = computed(() => this.#actions().all());
  readonly state = computed(() => this.#actions().state());

  get(id: string): BoundAction | undefined {
    return this.#actions().get(id);
  }
}
