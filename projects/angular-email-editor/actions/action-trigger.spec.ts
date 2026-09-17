import { Component, ElementRef, afterNextRender, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TextSelection } from 'prosemirror-state';
import {
  Editor,
  createEditor,
  htmlSourceExtensions,
  richTextExtensions,
} from 'angular-email-editor';
import { ActionTrigger } from './action-trigger';
import { injectActions } from './actions';

/** A toolbar the way a host writes one: its own buttons, the library's
    behaviour on them. The editor mounts after the first render — the
    toolbar is there before it, as in a real composer. */
@Component({
  imports: [ActionTrigger],
  template: `
    <div #surface></div>
    <div #sourceSurface></div>
    <button
      class="bold"
      [emailAction]="actions.get('bold')"
      [emailActionFocus]="returnFocus()"
      #bold="emailAction"
      [disabled]="bold.disabled()"
    ></button>
    <button class="table" [emailAction]="actions.get('table')"></button>
    <button class="quiet" [emailAction]="actions.get('italic')" [emailActionAria]="false"></button>
    <button class="unknown" [emailAction]="actions.get('no-such-action')"></button>
    <button class="link" [emailAction]="hosted.get('link')"></button>
    <button class="picker" [emailAction]="hosted.get('table')"></button>
    <button class="quote" [emailAction]="hosted.get('quote')"></button>
  `,
})
class Host {
  readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  readonly sourceSurface = viewChild.required<ElementRef<HTMLElement>>('sourceSurface');
  readonly returnFocus = signal(true);

  readonly rich = signal<Editor | undefined>(undefined);
  readonly source = signal<Editor | undefined>(undefined);
  readonly codeView = signal(false);

  /** One `computed`-shaped read is all the routing a code view needs. */
  readonly actions = injectActions(() => (this.codeView() ? this.source() : this.rich()));

  readonly openLink = vi.fn();
  readonly openPicker = vi.fn();
  readonly linkOn = signal(false);

  /** The same editor, with the host's own: a link dialog, and a size picker
      in place of the kit's "insert a table". */
  readonly hosted = injectActions(() => (this.codeView() ? this.source() : this.rich()), {
    host: [{ id: 'link', run: this.openLink, isActive: () => this.linkOn() }],
    override: { table: { run: this.openPicker } },
  });

  constructor() {
    afterNextRender(() => {
      this.rich.set(
        createEditor({
          parent: this.surface().nativeElement,
          extensions: richTextExtensions,
          content: '<p>Hello <strong>bold</strong> world</p>',
        }),
      );
      this.source.set(
        createEditor({
          parent: this.sourceSurface().nativeElement,
          extensions: htmlSourceExtensions,
        }),
      );
    });
  }
}

describe('injectActions + [emailAction]', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const button = (name: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(`.${name}`)!;

  const caret = async (pos: number, to?: number) => {
    const editor = host.rich()!;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos, to)),
    );
    await fixture.whenStable();
  };

  beforeEach(async () => {
    document.elementFromPoint ??= () => null;
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => {
    host.rich()?.destroy();
    host.source()?.destroy();
    (fixture.nativeElement as HTMLElement).remove();
  });

  it('binds to an editor that was made after the toolbar — no place in the kit needed', () => {
    expect(host.actions.get('bold')).toBeDefined();
    expect(host.actions.all().map((action) => action.id)).toEqual(
      host.rich()!.actions.map((action) => action.id),
    );
  });

  it('says a toggle is pressed as the caret moves — selection changes, not just edits', async () => {
    await caret(3);
    expect(button('bold').getAttribute('aria-pressed')).toBe('false');
    await caret(9);
    expect(button('bold').getAttribute('aria-pressed')).toBe('true');
  });

  it('runs the action on click and shows the new state', async () => {
    await caret(1, 6);
    button('bold').click();
    await fixture.whenStable();
    expect(host.rich()!.getHTML()).toContain('<strong style="font-weight: bold;">Hello');
    expect(button('bold').getAttribute('aria-pressed')).toBe('true');
  });

  it('puts the caret back in the editor after running — unless told not to', async () => {
    const focus = vi.spyOn(host.rich()!, 'focus');
    button('bold').click();
    expect(focus).toHaveBeenCalledTimes(1);

    host.returnFocus.set(false);
    await fixture.whenStable();
    button('bold').click();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('has no pressed state for what has no "on"', () => {
    expect(button('table').hasAttribute('aria-pressed')).toBe(false);
  });

  it('leaves ARIA to a widget that writes its own', async () => {
    await caret(3);
    expect(button('quiet').hasAttribute('aria-pressed')).toBe(false);
    expect(button('quiet').hasAttribute('aria-disabled')).toBe(false);
    button('quiet').click();
    await fixture.whenStable();
    expect(host.actions.get('italic')!.pressed()).toBe(true);
  });

  it('never writes the native disabled: how disabled looks is the host’s', () => {
    // .bold binds it itself, from the directive's state; .unknown does not.
    expect(button('unknown').getAttribute('aria-disabled')).toBe('true');
    expect(button('unknown').disabled).toBe(false);
    expect(button('bold').disabled).toBe(false);
  });

  it('is disabled, and runs nothing, for an action the kit does not have', async () => {
    expect(host.actions.get('no-such-action')).toBeUndefined();
    const before = host.rich()!.getHTML();
    button('unknown').click();
    await fixture.whenStable();
    expect(host.rich()!.getHTML()).toBe(before);
  });

  describe('a code view', () => {
    beforeEach(async () => {
      host.codeView.set(true);
      await fixture.whenStable();
    });

    it('offers the source pane’s actions: the marks stay, the rest has nothing to do', () => {
      expect(button('bold').hasAttribute('aria-disabled')).toBe(false);
      expect(button('bold').disabled).toBe(false);
      expect(button('table').getAttribute('aria-disabled')).toBe('true');
    });

    it('cannot say "pressed" from source text, so it does not', () => {
      expect(button('bold').hasAttribute('aria-pressed')).toBe(false);
    });

    it('runs on the source pane, and hands the caret back to it', () => {
      const exec = vi.spyOn(host.source()!, 'exec');
      const focus = vi.spyOn(host.source()!, 'focus');
      button('bold').click();
      expect(exec).toHaveBeenCalledTimes(1);
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it('is the rich editor’s again when the view switches back', async () => {
      host.codeView.set(false);
      await fixture.whenStable();
      expect(button('table').hasAttribute('aria-disabled')).toBe(false);
    });
  });

  describe('the host’s own actions', () => {
    it('runs the host’s function, and leaves focus to what it opened', () => {
      const focus = vi.spyOn(host.rich()!, 'focus');
      button('link').click();
      expect(host.openLink).toHaveBeenCalledTimes(1);
      expect(focus).not.toHaveBeenCalled();
      expect(host.hosted.get('link')!.external).toBe(true);
    });

    it('never calls it to ask: a dialog must not open on every transaction', async () => {
      await caret(3);
      await caret(9);
      expect(host.hosted.get('link')!.disabled()).toBe(false);
      expect(host.openLink).not.toHaveBeenCalled();
      expect(host.openPicker).not.toHaveBeenCalled();
    });

    it('is a toggle when it says when it is on', async () => {
      expect(button('link').getAttribute('aria-pressed')).toBe('false');
      host.linkOn.set(true);
      await caret(4);
      expect(button('link').getAttribute('aria-pressed')).toBe('true');
    });

    it('stands over a kit’s action: its run, the extension’s answers', async () => {
      button('picker').click();
      expect(host.openPicker).toHaveBeenCalledTimes(1);
      expect(host.rich()!.getHTML()).not.toContain('<table');
      // Untouched actions are the kit's own, as ever.
      expect(host.hosted.get('quote')!.external).toBe(false);
      expect(host.hosted.get('table')!.action?.title).toBe('Table');
    });

    it('lists the kit’s actions first, then what stands alone', () => {
      const ids = host.hosted.all().map((action) => action.id);
      expect(ids.at(-1)).toBe('link');
      expect(ids.filter((id) => id === 'table')).toHaveLength(1);
    });

    it('an override is only there where the kit’s action is; a host action always is', async () => {
      host.codeView.set(true);
      await fixture.whenStable();
      expect(host.hosted.get('table')).toBeUndefined();
      expect(button('picker').getAttribute('aria-disabled')).toBe('true');
      expect(host.hosted.get('link')).toBeDefined();
    });
  });

  it('stops listening to an editor it no longer watches', async () => {
    const rich = host.rich()!;
    const unsubscribed = vi.fn();
    const subscribe = rich.subscribe.bind(rich);
    vi.spyOn(rich, 'subscribe').mockImplementation((listener) => {
      const stop = subscribe(listener);
      return () => {
        unsubscribed();
        stop();
      };
    });
    // Away and back: the second watch is the spied one; leaving it again stops it.
    host.codeView.set(true);
    await fixture.whenStable();
    host.codeView.set(false);
    await fixture.whenStable();
    host.codeView.set(true);
    await fixture.whenStable();
    // Both of this host's lists watched it, and both let go.
    expect(unsubscribed).toHaveBeenCalledTimes(2);
  });
});
