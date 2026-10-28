import { Component, ElementRef, afterNextRender, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, debounce, form } from '@angular/forms/signals';
import { closeHistory, undo } from 'prosemirror-history';
import {
  Editor,
  PAGE_ROW_PADDING,
  centeredPageLayout,
  createEditor,
  emailExtensions,
  pageLayoutOf,
  sectionPaddingOf,
} from '@h-k-dev/angular-email-editor';
import { FieldKeys } from '@h-k-dev/angular-email-editor/keyboard';
import {
  columnSpacingModel,
  editorModel,
  pageLayoutModel,
  sectionBackgroundModel,
  sectionPaddingModel,
} from './editor-model';

/** A band's menu the way a host writes one: the models, a form over the
    padding, the fields on it. The editor mounts after the first render. */
@Component({
  imports: [FormField, FieldKeys],
  template: `
    <div #surface></div>
    <input class="block" type="number" [formField]="paddingFields.top" emailFieldKeys />
  `,
})
class Host {
  readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  readonly editor = signal<Editor | undefined>(undefined);

  readonly padding = sectionPaddingModel(() => this.editor());
  readonly fill = sectionBackgroundModel(() => this.editor());
  readonly spacing = columnSpacingModel(() => this.editor());
  readonly page = pageLayoutModel(() => this.editor());
  readonly paddingFields = form(this.padding, (p) => debounce(p, 'blur'));

  readonly reads = vi.fn((state) => sectionPaddingOf(state) ?? { top: 0, bottom: 0, inline: 0 });
  /** Counts its readings and its writes' commands. */
  readonly counted = editorModel(() => this.editor(), {
    read: this.reads,
    write: vi.fn(() => null),
    initial: { top: -1, bottom: -1, inline: -1 },
  });

  constructor() {
    afterNextRender(() =>
      this.editor.set(
        createEditor({
          parent: this.surface().nativeElement,
          extensions: emailExtensions,
          content: '<p>before</p>',
          parseMode: 'repair',
        }),
      ),
    );
  }
}

describe('editorModel', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let editor: Editor;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    editor = host.editor()!;
  });

  afterEach(() => editor.destroy());

  it('says its initial value until there is an editor', () => {
    const early = TestBed.createComponent(Host).componentInstance;
    expect(early.counted()).toEqual({ top: -1, bottom: -1, inline: -1 });
    expect(early.page().kind).toBe('none');
  });

  it('follows the editor: the band the caret is in, none outside one', () => {
    expect(host.padding()).toEqual({ top: 0, bottom: 0, inline: 0 });
    editor.commands['insertSection']('#f1f3f4');
    expect(host.padding()).toEqual({ top: 20, bottom: 20, inline: 16 });
    expect(host.fill()).toBe('#f1f3f4');
  });

  it('writes through the command, one undo step, and says what the document took', () => {
    editor.commands['insertSection']('#f1f3f4');
    // The insertion its own step, however soon the write comes after it.
    editor.view.dispatch(closeHistory(editor.state.tr));
    host.padding.set({ top: 41, bottom: 41, inline: 16 });
    // Snapped to the 4px grid by the command; the signal never held 41.
    expect(host.padding()).toEqual({ top: 40, bottom: 40, inline: 16 });
    expect(sectionPaddingOf(editor.state)).toEqual({ top: 40, bottom: 40, inline: 16 });
    undo(editor.state, editor.view.dispatch);
    expect(host.padding()).toEqual({ top: 20, bottom: 20, inline: 16 });

    host.fill.set(null);
    expect(host.fill()).toBeNull();
  });

  it('runs nothing for a value the document already says, and a refused write leaves the reading', () => {
    editor.commands['insertSection']('#f1f3f4');
    const write = vi.spyOn(editor, 'exec');
    host.padding.set({ top: 20, bottom: 20, inline: 16 });
    expect(write).not.toHaveBeenCalled();
    // Outside a band the command refuses: nothing changes.
    host.spacing.set({ block: 8, inline: 8, gap: 8 });
    expect(host.spacing()).toEqual({ block: 0, inline: 0, gap: 0 });
  });

  it('reads again on a change, but a keystroke that leaves the reading as it was notifies nobody', () => {
    editor.commands['insertSection']('#f1f3f4');
    const seen = host.counted();
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('x'));
      return true;
    });
    expect(host.counted()).toBe(seen);
    expect(host.reads).toHaveBeenCalled();
  });

  it('columnSpacingModel: the column’s padding and its block’s gap, each its own command', () => {
    editor.commands['insertColumns'](2);
    expect(host.spacing()).toEqual({ block: 0, inline: 0, gap: 0 });
    host.spacing.set({ block: 0, inline: 0, gap: 13 });
    expect(host.spacing()).toEqual({ block: 0, inline: 0, gap: 12 });
    host.spacing.set({ block: 8, inline: 0, gap: 12 });
    expect(host.spacing()).toEqual({ block: 8, inline: 0, gap: 12 });
  });

  it('pageLayoutModel: flat settings — none, a centred page, a page of rows — normalised', () => {
    expect(host.page()).toEqual({
      ...centeredPageLayout(),
      kind: 'none',
      rowPadding: PAGE_ROW_PADDING,
    });
    host.page.set({ ...host.page(), kind: 'centered' });
    expect(pageLayoutOf(editor.state)).toEqual(centeredPageLayout());
    host.page.set({ ...host.page(), width: 599 });
    expect(host.page().width).toBe(600);
    host.page.set({ ...host.page(), kind: 'table', rowPadding: 24 });
    expect(pageLayoutOf(editor.state)).toMatchObject({ kind: 'table', rowPadding: 24 });
    host.page.set({ ...host.page(), kind: 'none' });
    expect(pageLayoutOf(editor.state)).toBeNull();
  });

  it('stands under signal forms: a field commits once it is done with, and shows what was taken', async () => {
    editor.commands['insertSection']('#f1f3f4');
    await fixture.whenStable();
    const field = fixture.nativeElement.querySelector('input.block') as HTMLInputElement;
    expect(field.value).toBe('20');

    const write = vi.spyOn(editor, 'exec');
    for (const typed of ['2', '22']) {
      field.value = typed;
      field.dispatchEvent(new Event('input'));
    }
    // Debounced to the blur: nothing in the document while typing.
    expect(write).not.toHaveBeenCalled();
    field.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(write).toHaveBeenCalledTimes(1);
    expect(host.padding().top).toBe(24);
    expect(field.value).toBe('24');

    // Snapped back onto what the band already says: no change to the
    // model, and still the field shows it.
    field.value = '25';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(host.padding().top).toBe(24);
    expect(field.value).toBe('24');
  });
});
