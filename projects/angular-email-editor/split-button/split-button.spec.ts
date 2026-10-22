import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SplitButton } from './split-button';
import { SplitButtonLeading, SplitButtonTrailing } from './split-button-item';

/** A split button whose trailing half closes it — the case that has to
    hand focus over. */
@Component({
  imports: [SplitButton, SplitButtonLeading, SplitButtonTrailing],
  template: `<hk-split-button aria-label="Attachments" [split]="split()">
    <button hkSplitButtonLeading aria-label="Attach" (click)="picks = picks + 1">📎</button>
    <button hkSplitButtonTrailing aria-label="Show" (click)="split.set(false)"></button>
  </hk-split-button>`,
})
class Host {
  readonly split = signal(false);
  picks = 0;
}

describe('SplitButton', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const root = () => fixture.nativeElement as HTMLElement;
  const group = () => root().querySelector<HTMLElement>('hk-split-button')!;
  const leading = () => root().querySelector<HTMLButtonElement>('[hkSplitButtonLeading]')!;
  const trailing = () => root().querySelector<HTMLButtonElement>('[hkSplitButtonTrailing]')!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    document.body.appendChild(root());
    await fixture.whenStable();
  });

  afterEach(() => root().remove());

  it('is a named group of the host’s own buttons, typed so a form never submits', () => {
    expect(group().getAttribute('role')).toBe('group');
    expect(group().getAttribute('aria-label')).toBe('Attachments');
    expect(leading().type).toBe('button');
    expect(trailing().type).toBe('button');
  });

  it('alone, keeps the trailing half out of play', () => {
    expect(group().hasAttribute('data-split')).toBe(false);
    expect(leading().hasAttribute('data-split')).toBe(false);
    expect(trailing().hasAttribute('inert')).toBe(true);
  });

  it('split, reflects it on both halves and lets the trailing one in', async () => {
    host.split.set(true);
    await fixture.whenStable();

    expect(group().hasAttribute('data-split')).toBe(true);
    expect(leading().hasAttribute('data-split')).toBe(true);
    expect(trailing().hasAttribute('data-split')).toBe(true);
    expect(trailing().hasAttribute('inert')).toBe(false);
  });

  it('leaves each click to its own button', async () => {
    host.split.set(true);
    await fixture.whenStable();

    leading().click();
    expect(host.picks).toBe(1);
    expect(host.split()).toBe(true);
  });

  it('draws a chevron in the trailing half when the host gives no icon', () => {
    expect(trailing().querySelector('[data-slot=icon] svg')).not.toBeNull();
  });

  it('hands focus to the leading half when the trailing one closes the split', async () => {
    host.split.set(true);
    await fixture.whenStable();
    trailing().focus();
    expect(document.activeElement).toBe(trailing());

    trailing().click();
    await fixture.whenStable();

    expect(host.split()).toBe(false);
    expect(document.activeElement).toBe(leading());
  });

  it('hands focus over when the browser blurs the half going inert', () => {
    // Closed, with focus still on the trailing half — jsdom does not keep
    // focus out of an inert element, a browser takes it away: blur, with
    // nowhere for focus to go.
    trailing().focus();
    trailing().blur();

    expect(document.activeElement).toBe(leading());
  });

  it('leaves focus alone when it moves out on purpose', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    host.split.set(false);
    await fixture.whenStable();

    leading().focus();
    outside.focus();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
