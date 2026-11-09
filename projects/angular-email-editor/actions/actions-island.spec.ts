import {
  Component,
  Directive,
  ElementRef,
  afterNextRender,
  signal,
  viewChild,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TextSelection } from 'prosemirror-state';
import { Editor, createEditor, richTextExtensions } from '@h-k-dev/angular-email-editor';
import { ActionTrigger } from './action-trigger';
import { EMAIL_ACTIONS, injectActions } from './actions';
import { Actions } from './actions-island';
import { EMAIL_EDITOR, EditorRef } from './editor-ref';

/** A host whose editor mounts after the first render, as a composer's. */
@Directive()
abstract class WithEditor {
  readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  readonly editor = signal<Editor | undefined>(undefined);

  constructor() {
    afterNextRender(() => {
      this.editor.set(
        createEditor({
          parent: this.surface().nativeElement,
          extensions: richTextExtensions,
          content: '<p>Hello <strong>bold</strong> world</p>',
        }),
      );
    });
  }
}

/** Toolbars as islands: the list said once, on the element around the
    buttons. */
@Component({
  imports: [Actions, ActionTrigger],
  template: `
    <div #surface></div>
    <div class="of-editor" [emailActions]="editor()" #all="emailActions">
      <button class="bold" emailAction="bold"></button>
      <button class="own" emailAction="link" [emailActionFrom]="hosted"></button>
      <output>{{ all.all().length }}</output>
    </div>
    <div class="of-list" [emailActions]="hosted">
      <button class="link" emailAction="link"></button>
      <button class="bold" emailAction="bold"></button>
    </div>
  `,
})
class Toolbars extends WithEditor {
  readonly openLink = vi.fn();
  readonly hosted = injectActions(() => this.editor(), {
    host: [{ id: 'link', run: this.openLink }],
  });
}

/** A composer as the island: its editor beside its buttons, both provided
    once for everything in it — an overlay's content included. */
@Component({
  imports: [ActionTrigger],
  providers: [
    { provide: EMAIL_EDITOR, useExisting: Composer },
    { provide: EMAIL_ACTIONS, useFactory: () => injectActions() },
  ],
  template: `
    <div #surface></div>
    <button class="bold" emailAction="bold"></button>
  `,
})
class Composer extends WithEditor implements EditorRef {
  focus(): void {
    this.editor()?.focus();
  }
}

/** A trigger on no island, with nothing bound. */
@Component({
  imports: [ActionTrigger],
  template: `<button emailAction="bold"></button>`,
})
class Stranded {}

describe('the actions island', () => {
  let fixture: ComponentFixture<WithEditor>;

  const mount = async (host: typeof Toolbars | typeof Composer) => {
    document.elementFromPoint ??= () => null;
    fixture = TestBed.createComponent<WithEditor>(host);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  };
  const button = (selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(selector)!;
  const caret = async (pos: number) => {
    const editor = fixture.componentInstance.editor()!;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
    await fixture.whenStable();
  };

  afterEach(() => {
    fixture?.componentInstance.editor()?.destroy();
    (fixture?.nativeElement as HTMLElement | undefined)?.remove();
  });

  describe('[emailActions]', () => {
    beforeEach(() => mount(Toolbars));

    it('gives a bare trigger the editor’s actions: pressed as the caret moves, run on click', async () => {
      const bold = button('.of-editor .bold');
      await caret(3);
      expect(bold.getAttribute('aria-pressed')).toBe('false');
      await caret(9);
      expect(bold.getAttribute('aria-pressed')).toBe('true');

      const exec = vi.spyOn(fixture.componentInstance.editor()!, 'exec');
      bold.click();
      expect(exec).toHaveBeenCalledTimes(1);
    });

    it('is the list itself, for a toolbar that lists what the kit declares', () => {
      const editor = fixture.componentInstance.editor()!;
      expect(button('.of-editor').querySelector('output')!.textContent).toBe(
        String(editor.actions.length),
      );
    });

    it('takes a list the host made, its own actions in it', () => {
      const host = fixture.componentInstance as Toolbars;
      button('.of-list .link').click();
      expect(host.openLink).toHaveBeenCalledTimes(1);
      // The kit's are in that list too.
      expect(button('.of-list .bold').hasAttribute('aria-disabled')).toBe(false);
    });

    it('leaves a trigger its own list: the editor’s has no "link"', () => {
      const host = fixture.componentInstance as Toolbars;
      expect(button('.of-editor .own').hasAttribute('aria-disabled')).toBe(false);
      button('.of-editor .own').click();
      expect(host.openLink).toHaveBeenCalledTimes(1);
    });
  });

  describe('a component that provides its editor', () => {
    beforeEach(() => mount(Composer));

    it('serves `injectActions()` and every bare trigger in it', async () => {
      const bold = button('.bold');
      expect(bold.hasAttribute('aria-disabled')).toBe(false);
      await caret(9);
      expect(bold.getAttribute('aria-pressed')).toBe('true');

      const focus = vi.spyOn(fixture.componentInstance.editor()!, 'focus');
      bold.click();
      await fixture.whenStable();
      expect(bold.getAttribute('aria-pressed')).toBe('false');
      expect(focus).toHaveBeenCalledTimes(1);
    });
  });

  it('says so when a bare trigger stands on no island', () => {
    const stranded = TestBed.createComponent(Stranded);
    expect(() => stranded.detectChanges()).toThrowError(
      /\[emailAction\]="bold" has no actions.*\[emailActions\] on an ancestor/,
    );
  });

  it('has no editor to default to off an island', () => {
    expect(() => TestBed.runInInjectionContext(() => injectActions())).toThrowError(/EMAIL_EDITOR/);
  });
});
