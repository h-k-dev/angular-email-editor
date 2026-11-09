import { Component, ElementRef, afterNextRender, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NodeSelection } from 'prosemirror-state';
import {
  Editor,
  ImageRefusal,
  createEditor,
  createImageSources,
  emailExtensions,
} from '@h-k-dev/angular-email-editor';
import { EMAIL_EDITOR, EditorRef } from '@h-k-dev/angular-email-editor/actions';
import { ImageSource } from './image-source';

/** A popover the way a host writes one: its own field and button, the
    library's behaviour on the field. */
@Component({
  imports: [ImageSource],
  template: `
    <div #surface></div>
    @if (open()) {
      <input
        type="url"
        [emailImageSource]="editor()"
        #link="emailImageSource"
        [attr.aria-invalid]="link.refused()"
        (emailImageSourceClosed)="closed.push($event); open.set(false)"
      />
      <button (click)="link.apply()"></button>
    }
  `,
})
class Host {
  readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  readonly editor = signal<Editor | undefined>(undefined);
  readonly open = signal(false);
  readonly closed: boolean[] = [];
  readonly refused: ImageRefusal[] = [];

  constructor() {
    afterNextRender(() => {
      this.editor.set(
        createEditor({
          parent: this.surface().nativeElement,
          extensions: [
            ...emailExtensions,
            createImageSources({
              files: 'placeholder',
              accept: (src) => /^https:\/\//i.test(src),
              onRefused: (refusal) => this.refused.push(refusal),
            }),
          ],
          content:
            '<div>a <img width="200" height="100" alt="hero"> b <img src="https://example.com/y.png"></div>',
        }),
      );
    });
  }
}

describe('[emailImageSource]', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  // <div>(0) a ␣ → the placeholder at 3, then ␣ b ␣ → the picture at 7.
  const placeholder = 3;
  const picture = 7;

  const editor = () => host.editor()!;
  const field = () => (fixture.nativeElement as HTMLElement).querySelector('input')!;
  const attrs = (pos: number) => editor().state.doc.nodeAt(pos)?.attrs;
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
  const key = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
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

  it('shows a placeholder as empty and a picture by its address, focused', async () => {
    await select(placeholder);
    await open();
    expect(field().value).toBe('');
    expect(document.activeElement).toBe(field());
    await select(picture);
    expect(field().value).toBe('https://example.com/y.png');
  });

  it('fills a placeholder on Enter, its frame and alt kept, and closes', async () => {
    await select(placeholder);
    await open();
    type(' https://example.com/hero.png ');
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(attrs(placeholder)).toMatchObject({
      src: 'https://example.com/hero.png',
      alt: 'hero',
      width: 200,
      height: null,
    });
    expect(host.closed).toEqual([true]);
  });

  it('keeps the field open on an address the rules refuse, refused until the next keystroke', async () => {
    await select(placeholder);
    await open();
    type('http://example.com/hero.png');
    key('Enter');
    await fixture.whenStable();
    expect(attrs(placeholder)!['src']).toBeNull();
    expect(host.closed).toEqual([]);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(host.refused).toEqual([{ reason: 'source', src: 'http://example.com/hero.png' }]);
    type('https://example.com/hero.png');
    await fixture.whenStable();
    expect(field().getAttribute('aria-invalid')).toBe('false');
  });

  it('Escape and an empty field leave the image as it was', async () => {
    await select(picture);
    await open();
    type('https://example.com/other.png');
    key('Escape');
    expect(attrs(picture)!['src']).toBe('https://example.com/y.png');
    await open();
    type('');
    key('Enter');
    expect(attrs(picture)!['src']).toBe('https://example.com/y.png');
    expect(host.closed).toEqual([false, false]);
  });
});

/** A composer as the island: the popover's field binds no editor. */
@Component({
  imports: [ImageSource],
  providers: [{ provide: EMAIL_EDITOR, useExisting: Island }],
  template: `
    <div #surface></div>
    @if (open()) {
      <input type="url" emailImageSource (emailImageSourceClosed)="open.set(false)" />
    }
  `,
})
class Island implements EditorRef {
  readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  readonly editor = signal<Editor | undefined>(undefined);
  readonly open = signal(false);

  constructor() {
    afterNextRender(() => {
      this.editor.set(
        createEditor({
          parent: this.surface().nativeElement,
          extensions: emailExtensions,
          content: '<div>a <img src="https://example.com/y.png"> b</div>',
        }),
      );
    });
  }

  focus(): void {
    this.editor()?.focus();
  }
}

describe('[emailImageSource] on an island', () => {
  it('takes the island’s editor when none is bound', async () => {
    document.elementFromPoint ??= () => null;
    const fixture = TestBed.createComponent(Island);
    const host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const editor = host.editor()!;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 3)));
    host.open.set(true);
    await fixture.whenStable();

    const field = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(field.value).toBe('https://example.com/y.png');
    field.value = 'https://example.com/z.png';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(editor.state.doc.nodeAt(3)?.attrs['src']).toBe('https://example.com/z.png');
    expect(host.open()).toBe(false);

    editor.destroy();
    (fixture.nativeElement as HTMLElement).remove();
  });
});
