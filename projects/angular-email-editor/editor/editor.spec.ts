import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';
import { undo } from 'prosemirror-history';
import { Extension, richTextExtensions } from '@h-k-dev/angular-email-editor';
import { EMAIL_EDITOR, EditorCodec, EditorRef, EmailEditor, injectEditor } from './editor';

/** A text codec that pretty-prints what it is shown (upper case, here),
    the way a source pane formats its HTML. */
const SHOUT: EditorCodec = {
  read: (editor) => editor.getText(),
  write: (editor, value, options) => editor.setText(value.toUpperCase(), options),
  canonical: false,
};

/** Something inside the editor's element that wants the editor. */
@Component({ selector: 'probe', template: '' })
class Probe {
  readonly ref: EditorRef = injectEditor();
}

@Component({
  imports: [EmailEditor, FormField, Probe],
  template: `
    <div
      class="body"
      [emailEditor]="kit()"
      [formField]="fields.body"
      [emailEditorPaused]="paused()"
      (emailEditorMounted)="mounts.push($event)"
      (emailEditorChange)="changes = changes + 1"
    ><probe /></div>
    <div class="source" [emailEditor]="kit()" [emailEditorCodec]="shout" [(value)]="source"></div>
    <button class="elsewhere">elsewhere</button>
  `,
})
class Host {
  readonly kit = signal<readonly Extension[]>(richTextExtensions);
  readonly paused = signal(false);
  readonly model = signal({ body: '<p>draft' });
  readonly fields = form(this.model);
  readonly source = signal('hello');
  readonly shout = SHOUT;
  readonly mounts: unknown[] = [];
  changes = 0;
  readonly body = viewChild.required(EmailEditor);
  readonly probe = viewChild.required(Probe);
}

describe('EmailEditor', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const view = () => host.body().editor()!.view;
  const typeText = (text: string) => view().dispatch(view().state.tr.insertText(text));

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('mounts a render in, takes the value it was given, and publishes the canonical form as its baseline', () => {
    const body = host.body();
    expect(body.editor()).toBeDefined();
    expect(fixture.nativeElement.querySelector('.body .ProseMirror')).not.toBeNull();
    expect(host.model().body).toBe('<p>draft</p>');
    expect(body.baseline()).toBe('<p>draft</p>');
    expect(host.mounts).toEqual([body.editor()]);
    // Taking the value in is no change of the user's.
    expect(host.changes).toBe(0);
  });

  it('provides itself to what is inside it', () => {
    expect(host.probe().ref).toBe(host.body());
    expect(TestBed.inject(EMAIL_EDITOR, null)).toBeNull();
  });

  it('sends every change out, and takes a value from outside in', async () => {
    typeText('x');
    expect(host.model().body).toContain('x');
    expect(host.changes).toBe(1);

    host.model.set({ body: '<p>from a draft</p>' });
    await fixture.whenStable();
    expect(view().state.doc.textContent).toBe('from a draft');
  });

  it('never writes into an editor being typed in: the value waits for the user to leave', async () => {
    view().focus();
    expect(view().hasFocus()).toBe(true);
    host.model.set({ body: '<p>another tab</p>' });
    await fixture.whenStable();
    expect(view().state.doc.textContent).toBe('draft');

    (fixture.nativeElement.querySelector('.elsewhere') as HTMLElement).focus();
    expect(view().state.doc.textContent).toBe('another tab');
    // …and leaving is the form's touch.
    expect(host.fields.body().touched()).toBe(true);
  });

  it('replace() writes even into a focused editor, as one undo step', () => {
    view().focus();
    host.body().replace('<p>as saved</p>');
    expect(view().state.doc.textContent).toBe('as saved');
    expect(host.model().body).toBe('<p>as saved</p>');
    undo(view().state, view().dispatch);
    expect(view().state.doc.textContent).toBe('draft');
  });

  it('paused, a value waits — and goes in once it is not', async () => {
    host.paused.set(true);
    await fixture.whenStable();
    host.model.set({ body: '<p>later</p>' });
    await fixture.whenStable();
    expect(view().state.doc.textContent).toBe('draft');
    host.paused.set(false);
    await fixture.whenStable();
    expect(view().state.doc.textContent).toBe('later');
  });

  it('a new kit is a new editor, a render later — the old one takes nothing in meanwhile', async () => {
    const first = host.body().editor()!;
    const setContent = vi.spyOn(first, 'setContent');
    // The host converts the value for the new kit as it switches.
    host.kit.set([...richTextExtensions]);
    host.model.set({ body: '<p>converted</p>' });
    await fixture.whenStable();
    expect(setContent).not.toHaveBeenCalled();
    const second = host.body().editor()!;
    expect(second).not.toBe(first);
    expect(first.view.isDestroyed).toBe(true);
    expect(second.state.doc.textContent).toBe('converted');
    expect(host.body().baseline()).toBe('<p>converted</p>');
    expect(host.mounts).toEqual([first, second]);
  });

  it('focus() before there is an editor puts the caret in as it mounts', async () => {
    fixture.destroy();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    // A render without the hooks after it: the view, not yet the editor.
    fixture.componentRef.changeDetectorRef.detectChanges();
    expect(host.body().editor()).toBeUndefined();
    host.body().focus();
    await fixture.whenStable();
    expect(view().hasFocus()).toBe(true);
  });

  it('is read-only while the form disables it', async () => {
    const { disabled } = await import('@angular/forms/signals');
    fixture.destroy();
    @Component({
      imports: [EmailEditor, FormField],
      template: `<div [emailEditor]="kit" [formField]="fields.body"></div>`,
    })
    class Locked {
      readonly kit = richTextExtensions;
      readonly fields = form(signal({ body: '<p>x</p>' }), (p) => disabled(p.body));
      readonly body = viewChild.required(EmailEditor);
    }
    const locked = TestBed.createComponent(Locked);
    await locked.whenStable();
    expect(locked.componentInstance.body().editor()!.view.editable).toBe(false);
    locked.destroy();
  });

  it('a codec that is not canonical writes what it is shown and publishes only the user’s changes', async () => {
    const source = fixture.debugElement.children[1].injector.get(EmailEditor);
    const editor = source.editor()!;
    expect(editor.getText()).toBe('HELLO');
    // What it was shown stands as given: no shouting back.
    expect(host.source()).toBe('hello');
    expect(source.baseline()).toBe('hello');

    host.source.set('again');
    await fixture.whenStable();
    expect(editor.getText()).toBe('AGAIN');
    expect(host.source()).toBe('again');

    editor.view.dispatch(editor.state.tr.insertText('!', editor.state.doc.content.size - 1));
    expect(host.source()).toBe('AGAIN!');
  });
});
