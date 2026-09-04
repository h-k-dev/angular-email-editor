import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Compose } from './compose';
import { Viewport } from '../viewport';

// jsdom lacks what the textMetrics extension needs at editor mount
// (ResizeObserver, a canvas 2D context for glyph measurement) — without the
// stubs, createEditor throws mid-mount and the email pane silently never
// wires up in tests.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const context2dStub = {
  font: '',
  measureText: (text: string) => ({ width: text.length * 7 }),
};
HTMLCanvasElement.prototype.getContext = (() => context2dStub) as never;

describe('Compose', () => {
  let component: Compose;
  let fixture: ComponentFixture<Compose>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Compose],
    }).compileComponents();

    fixture = TestBed.createComponent(Compose);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('an external html write during focus applies on blur — a draft restore is never dropped', async () => {
    // Put the user "in" the editor (mount focuses it too, but not reliably
    // under the test harness — make it explicit).
    // Two editor roots live on the page (body + source): name the one meant.
    const pm = fixture.nativeElement.querySelector('[aria-label="Message body"]') as HTMLElement;
    pm.focus();
    expect(document.activeElement).toBe(pm);

    // A draft restore (or import) lands while the user is "in" the editor —
    // written to the pane's model, the exact surface a host binds against.
    const pane = (component as any).emailPane();
    pane.html.set('<div>restored draft</div>');
    await fixture.whenStable(); // flush the pane's sync effect
    expect(pane.html()).toBe('<div>restored draft</div>');
    // Protected while focused: the typing surface must not be rewritten…
    expect(pm.textContent).not.toContain('restored draft');

    // …but the value is not lost: leaving the editor catches up.
    pm.blur();
    expect(pm.textContent).toContain('restored draft');
  });

  it("the toolbar's </> moves the HTML source into the editing surface's place and back", async () => {
    const root = fixture.nativeElement as HTMLElement;
    const editor = root.querySelector('.editor') as HTMLElement;
    const code = root.querySelector('.code') as HTMLElement;
    const source = root.querySelector('section[html-email-compose]') as HTMLElement;
    const sourceEditor = source.querySelector('[aria-label="Email HTML source"]');
    const toggle = root.querySelector('[aria-label="HTML source"]') as HTMLButtonElement;
    const bold = root.querySelector('.toolbar [aria-label="Bold"]') as HTMLButtonElement;
    const quote = root.querySelector('.toolbar [aria-label="Quote"]') as HTMLButtonElement;
    const send = root.querySelector('.writer-bar__send') as HTMLButtonElement;

    // Hidden by default, in its own column (a sibling of the composer).
    expect(source.hidden).toBe(true);
    expect(source.parentElement).toBe(root);
    expect(editor.hidden).toBe(false);
    expect(code.hidden).toBe(true);

    toggle.click();
    await fixture.whenStable();
    // The very same node moved into the code slot — not a re-created pane.
    expect(source.hidden).toBe(false);
    expect(code.contains(source)).toBe(true);
    expect(source.querySelector('[aria-label="Email HTML source"]')).toBe(sourceEditor);
    expect(editor.hidden).toBe(true);
    expect(code.hidden).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    // Marks route to the source pane (its kit mirrors them) and Send lives
    // in the writer's bar — both stay live; block commands have no source
    // twin and lock.
    expect(bold.disabled).toBe(false);
    expect(quote.disabled).toBe(true);
    expect(send.disabled).toBe(false);
    expect(root.querySelector('.toolbar [aria-label="Send"]')).toBeNull();

    toggle.click();
    await fixture.whenStable();
    // …and back home, hidden again.
    expect(source.parentElement).toBe(root);
    expect(source.hidden).toBe(true);
    expect(editor.hidden).toBe(false);
    expect(code.hidden).toBe(true);
    expect(quote.disabled).toBe(false);
  });

  it('detach shows the HTML source beside the editor; the two buttons switch each other', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const editor = root.querySelector('.editor') as HTMLElement;
    const code = root.querySelector('.code') as HTMLElement;
    const source = root.querySelector('section[html-email-compose]') as HTMLElement;
    const detach = root.querySelector('[aria-label="Detach HTML source"]') as HTMLButtonElement;
    const codeToggle = root.querySelector('[aria-label="HTML source"]') as HTMLButtonElement;
    const quote = root.querySelector('.toolbar [aria-label="Quote"]') as HTMLButtonElement;

    detach.click();
    await fixture.whenStable();
    expect(root.classList.contains('compose--detached')).toBe(true);
    expect(source.hidden).toBe(false);
    expect(source.parentElement).toBe(root); // its own column, not the slot
    expect(editor.hidden).toBe(false); // the editor stays, and stays the target
    expect(quote.disabled).toBe(false);
    expect(detach.getAttribute('aria-pressed')).toBe('true');

    // Pressing the other button switches views rather than stacking them.
    codeToggle.click();
    await fixture.whenStable();
    expect(root.classList.contains('compose--detached')).toBe(false);
    expect(code.contains(source)).toBe(true);
    expect(detach.getAttribute('aria-pressed')).toBe('false');

    detach.click();
    await fixture.whenStable();
    expect(code.contains(source)).toBe(false);
    expect(root.classList.contains('compose--detached')).toBe(true);

    // Pressing the active one again hides the source.
    detach.click();
    await fixture.whenStable();
    expect(root.classList.contains('compose--detached')).toBe(false);
    expect(source.hidden).toBe(true);
  });

  it("the writer's Send asks the editor for its intent, which reaches the host", async () => {
    const root = fixture.nativeElement as HTMLElement;
    const pm = root.querySelector('[aria-label="Message body"]') as HTMLElement;
    pm.focus();
    document.execCommand?.('insertText', false, 'hello');
    (component as any).emailPane().html.set('<div>hello</div>');
    pm.blur();
    await fixture.whenStable();

    (root.querySelector('.writer-bar__send') as HTMLButtonElement).click();
    await fixture.whenStable();
    // The host's stand-in transport reports what it was handed: envelope and body.
    const note = root.querySelector('.status__send')?.textContent ?? '';
    expect(note).toContain('Send intent');
    expect(note).toContain('to 0 recipients');
    expect(note).toContain('no subject');
  });

  it('the preview is a detachable pane too — hidden by default, docked to the left', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const preview = root.querySelector('section[email-preview]') as HTMLElement;
    const composer = root.querySelector('section[email-compose]') as HTMLElement;
    const toggle = root.querySelector('.toolbar [aria-label="Preview"]') as HTMLButtonElement;

    expect(preview.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    await fixture.whenStable();
    expect(preview.hidden).toBe(false);
    expect(root.classList.contains('compose--preview')).toBe(true);
    // To the left: before the composer, in DOM as on screen.
    expect(
      preview.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    toggle.click();
    await fixture.whenStable();
    expect(preview.hidden).toBe(true);
  });
});

describe('Compose below the docking breakpoint', () => {
  it('drops the dock-out buttons from the toolbar and collapses a docked pane', async () => {
    const narrow = signal(false);
    await TestBed.configureTestingModule({
      imports: [Compose],
      providers: [{ provide: Viewport, useValue: { narrow: narrow.asReadonly() } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Compose);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const btn = (label: string) =>
      root.querySelector(`.toolbar [aria-label="${label}"]`) as HTMLButtonElement | null;

    // Wide: dock the preview and the source.
    btn('Preview')!.click();
    btn('Detach HTML source')!.click();
    await fixture.whenStable();
    expect(root.classList.contains('compose--detached')).toBe(true);
    expect(root.classList.contains('compose--preview')).toBe(true);

    // Narrow: the options are gone, the docked panes collapse — code view's
    // button (in place) stays.
    narrow.set(true);
    await fixture.whenStable();
    expect(btn('Preview')).toBeNull();
    expect(btn('Detach HTML source')).toBeNull();
    expect(btn('HTML source')).not.toBeNull();
    expect(root.classList.contains('compose--detached')).toBe(false);
    expect(root.classList.contains('compose--preview')).toBe(false);
    // The status strip is desktop chrome.
    expect(root.querySelector('footer.status')).toBeNull();

    // Wide again: the options return; nothing re-docks by itself.
    narrow.set(false);
    await fixture.whenStable();
    expect(btn('Preview')).not.toBeNull();
    expect(root.classList.contains('compose--preview')).toBe(false);
    expect(root.querySelector('footer.status')).not.toBeNull();
  });
});
