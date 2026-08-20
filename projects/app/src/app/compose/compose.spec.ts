import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Compose } from './compose';

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
    const pm = fixture.nativeElement.querySelector('.aee-editor') as HTMLElement;
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
});
