import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Selection, TextSelection } from 'prosemirror-state';

import { HtmlEmailCompose } from './html-email-compose';

describe('HtmlEmailCompose', () => {
  let component: HtmlEmailCompose;
  let fixture: ComponentFixture<HtmlEmailCompose>;

  const lines = () => fixture.nativeElement.querySelectorAll('.aee-code-line').length;

  /** Incoming html is paced (a shown source throttles, a hidden lint
      debounces): wait out the longest window, then settle. */
  const paced = async () => {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HtmlEmailCompose],
    }).compileComponents();

    fixture = TestBed.createComponent(HtmlEmailCompose);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('wraps by default; Alt+Z switches to scrolling and back, remembered by this browser', async () => {
    const host = fixture.nativeElement as HTMLElement;
    const altZ = () => {
      const event = new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      host.querySelector('.aee-editor')!.dispatchEvent(event);
      return event;
    };
    expect(component.wrap()).toBe(true);
    expect(host.hasAttribute('data-wrap')).toBe(false);

    expect(altZ().defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(host.getAttribute('data-wrap')).toBe('off');
    expect(localStorage.getItem('angular-email-editor:source-wrap')).toBe('off');

    altZ();
    await fixture.whenStable();
    expect(host.hasAttribute('data-wrap')).toBe(false);
    expect(localStorage.getItem('angular-email-editor:source-wrap')).toBeNull();
  });

  it('applies incoming html to its editor while active', async () => {
    component.html.set('<p>One</p><p>Two</p>');
    await paced();
    expect(component.editor()!.getText()).toContain('<p>Two</p>');
  });

  it('takes a press on its own room under the last line as a press on the source’s end', async () => {
    component.html.set('<p>One</p><p>Two</p>');
    await paced();
    const host = fixture.nativeElement as HTMLElement;
    const editor = component.editor()!;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)),
    );

    // jsdom lays nothing out: give the pane a box for the press to land in.
    Object.defineProperty(host, 'clientWidth', { value: 400 });
    Object.defineProperty(host, 'clientHeight', { value: 300 });
    const press = new MouseEvent('mousedown', {
      button: 0,
      clientX: 0,
      clientY: 0,
      bubbles: true,
      cancelable: true,
    });
    host.dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
    const { selection, doc } = editor.state;
    expect(selection.empty).toBe(true);
    expect(selection.head).toBe(Selection.atEnd(doc).head);
  });

  it('leaves a press on its scrollbar to the scrollbar', async () => {
    const host = fixture.nativeElement as HTMLElement;
    // No box in jsdom: every press is past the pane's client area, where
    // its scrollbars are.
    const press = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    host.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
  });

  describe('while hidden', () => {
    beforeEach(async () => {
      fixture.componentRef.setInput('active', false);
      await fixture.whenStable();
    });

    it('leaves the editor’s DOM alone', async () => {
      const before = lines();
      const text = component.editor()!.getText();

      component.html.set('<p>One</p><p>Two</p><p>Three</p>');
      await fixture.whenStable();
      expect(component.editor()!.getText()).toBe(text);
      expect(lines()).toBe(before);
    });

    it('still lints the text, so the problems strip stays live', async () => {
      component.html.set('<p><img src="a.png"></p>');
      await paced();
      expect(component.diagnostics().length).toBeGreaterThan(0);

      component.html.set('<p>fine</p>');
      await paced();
      expect(component.diagnostics()).toEqual([]);
    });

    it('lints once typing rests — not once per keystroke', async () => {
      const lints: unknown[] = [];
      const subscription = component.diagnostics.subscribe((d) => lints.push(d));
      for (const html of ['<p>a</p>', '<p>ab</p>', '<p>abc</p>', '<p><img src="a.png"></p>']) {
        component.html.set(html);
        await fixture.whenStable();
      }
      expect(lints).toEqual([]);
      await paced();
      expect(lints.length).toBe(1);
      expect(component.diagnostics().length).toBeGreaterThan(0);
      subscription.unsubscribe();
    });

    it('catches up, and lints itself, once shown again', async () => {
      component.html.set('<p><img src="a.png"></p>');
      await paced();
      const hidden = component.diagnostics();

      fixture.componentRef.setInput('active', true);
      await fixture.whenStable();
      expect(component.editor()!.getText()).toContain('<p><img src="a.png"></p>');
      expect(component.diagnostics()).toEqual(hidden);
    });
  });
});
