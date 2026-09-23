import { Component, ElementRef, afterNextRender, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { Editor, createEditor, emailExtensions } from 'angular-email-editor';
import { ImageAlt } from './image-alt';

/** A popover the way a host writes one: its own field and button, the
    library's behaviour on the field. */
@Component({
  imports: [ImageAlt],
  template: `
    <div #surface></div>
    @if (open()) {
      <input
        [emailImageAlt]="editor()"
        [emailImageAltFocus]="returnFocus()"
        #alt="emailImageAlt"
        (emailImageAltClosed)="closed.push($event); open.set(false)"
      />
      <button (click)="alt.apply()"></button>
    }
  `,
})
class Host {
  readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  readonly editor = signal<Editor | undefined>(undefined);
  readonly open = signal(false);
  readonly returnFocus = signal(true);
  readonly closed: boolean[] = [];

  constructor() {
    afterNextRender(() => {
      this.editor.set(
        createEditor({
          parent: this.surface().nativeElement,
          extensions: emailExtensions,
          content: '<div>a <img src="x.png" alt="dot"> b <img src="y.png"></div>',
        }),
      );
    });
  }
}

describe('[emailImageAlt]', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  // <div>(0) a ␣ → the first image at 3, then ␣ b ␣ → the second at 7.
  const first = 3;
  const second = 7;

  const editor = () => host.editor()!;
  const field = () => (fixture.nativeElement as HTMLElement).querySelector('input')!;
  const alt = (pos: number) => editor().state.doc.nodeAt(pos)?.attrs['alt'];
  const select = async (pos: number) => {
    editor().view.dispatch(
      editor().state.tr.setSelection(NodeSelection.create(editor().state.doc, pos)),
    );
    await fixture.whenStable();
  };
  const open = async () => {
    host.open.set(true);
    await fixture.whenStable();
  };
  const key = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    field().dispatchEvent(event);
    return event;
  };
  const type = (value: string) => {
    field().value = value;
    field().dispatchEvent(new Event('input'));
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
    host.editor()?.destroy();
    (fixture.nativeElement as HTMLElement).remove();
  });

  it('shows the selected image’s alt, focused and selected so typing replaces it', async () => {
    await select(first);
    await open();
    expect(field().value).toBe('dot');
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 3]);
  });

  it('follows another image being selected; one without alt shows empty', async () => {
    await select(first);
    await open();
    await select(second);
    expect(field().value).toBe('');
  });

  it('applies on Enter — trimmed — keeps the image selected, hands the caret back', async () => {
    await select(first);
    await open();
    const focus = vi.spyOn(editor(), 'focus');
    type('  A red square ');
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(alt(first)).toBe('A red square');
    expect(editor().state.selection).toBeInstanceOf(NodeSelection);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(host.closed).toEqual([true]);
  });

  it('an emptied field takes the alt off', async () => {
    await select(first);
    await open();
    type('');
    key('Enter');
    expect(alt(first)).toBeNull();
  });

  it('cancels on Escape: the alt stays as it was', async () => {
    await select(first);
    await open();
    type('changed my mind');
    key('Escape');
    expect(alt(first)).toBe('dot');
    expect(host.closed).toEqual([false]);
  });

  it('leaves an IME its own Enter and Escape', async () => {
    await select(first);
    await open();
    type('画像');
    expect(key('Enter', { isComposing: true }).defaultPrevented).toBe(false);
    key('Escape', { isComposing: true });
    expect(alt(first)).toBe('dot');
    expect(host.closed).toEqual([]);
  });

  it('works for a drag over the image alone, and the host’s button applies too', async () => {
    editor().view.dispatch(
      editor().state.tr.setSelection(TextSelection.create(editor().state.doc, first, first + 1)),
    );
    await open();
    type('dragged');
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    expect(alt(first)).toBe('dragged');
    expect(editor().state.selection.from).toBe(first);
    expect(editor().state.selection.to).toBe(first + 1);
  });

  it('says it applied nothing when no image is selected', async () => {
    editor().view.dispatch(
      editor().state.tr.setSelection(TextSelection.create(editor().state.doc, 1)),
    );
    await open();
    expect(field().value).toBe('');
    type('orphan');
    key('Enter');
    expect(host.closed).toEqual([false]);
    expect(alt(first)).toBe('dot');
  });

  it('keeps focus where it is when told to', async () => {
    host.returnFocus.set(false);
    await select(first);
    await open();
    const focus = vi.spyOn(editor(), 'focus');
    key('Enter');
    expect(focus).not.toHaveBeenCalled();
  });
});
