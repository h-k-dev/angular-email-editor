import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DropHint, DropHintArt } from './drop-hint';

/** A host the way a zone uses it: the zone's drag state and the trade to
    picture, nothing else. */
@Component({
  imports: [DropHint],
  template: `
    <div
      drop-hint
      [art]="art()"
      heading="Drop to attach"
      text="Anything dropped on the message is attached. To place an image in the text instead, drop it where you write."
      [active]="active()"
    ></div>
  `,
})
class Host {
  readonly active = signal(false);
  readonly art = signal<DropHintArt>('attach');
}

describe('DropHint', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let root: HTMLElement;

  const hint = () => root.querySelector('.hint');
  const element = () => root.querySelector('[drop-hint]') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('draws nothing at rest — a zone keeps no permanent placard', () => {
    expect(hint()).toBeNull();
    expect(element().classList.contains('is-active')).toBe(false);
  });

  it('shows the picture, the outcome and the escape while a file hovers', async () => {
    host.active.set(true);
    await fixture.whenStable();

    expect(hint()).not.toBeNull();
    expect(element().classList.contains('is-active')).toBe(true);
    expect(root.querySelector('.hint__art')).not.toBeNull();
    expect(root.querySelector('.hint__title')?.textContent).toContain('Drop to attach');
    // The other half of the rule — where the *other* thing happens — has to
    // be on screen too, or the zones are indistinguishable.
    expect(root.querySelector('.hint__body')?.textContent).toContain('in the text instead');
  });

  it('pictures the trade it is given — each art its own drawing', async () => {
    host.active.set(true);
    await fixture.whenStable();
    // The attachment trade has no sun; the image one does.
    expect(root.querySelectorAll('.hint__art circle').length).toBe(0);

    host.art.set('inline');
    await fixture.whenStable();
    expect(root.querySelectorAll('.hint__art circle').length).toBe(1);
  });

  it('takes the hint back down when the drag leaves', async () => {
    host.active.set(true);
    await fixture.whenStable();
    host.active.set(false);
    await fixture.whenStable();

    expect(hint()).toBeNull();
  });

  it('stays out of the accessibility tree — it is drag feedback, not content', () => {
    expect(element().getAttribute('aria-hidden')).toBe('true');
  });
});
