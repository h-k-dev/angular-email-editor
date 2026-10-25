import { Component, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Playground, PlaygroundAction, PlaygroundSubject, knob } from './playground';
import { PlaygroundFrame } from './playground-frame';

/** A playground as the real ones are: it provides the bench, the frame
    reads it. */
@Component({
  imports: [PlaygroundFrame, PlaygroundSubject],
  providers: [Playground],
  template: `
    <playground-frame [knobs]="knobs" [actions]="actions" [value]="{ on: on() }">
      <button
        type="button"
        playgroundSubject="Button"
        [attr.aria-pressed]="on()"
        [attr.data-label]="label()"
        (click)="playground.log('clicked', { on: on() })"
      >
        {{ label() }}
      </button>
    </playground-frame>
  `,
})
class Host {
  protected readonly playground = inject(Playground);
  readonly on = signal(false);
  readonly label = signal('Press');
  readonly knobs = [knob.boolean('on', this.on), knob.text('label', this.label)];
  readonly actions: readonly PlaygroundAction[] = [
    { name: 'toggle()', run: () => this.on.update((on) => !on) },
  ];
}

describe('PlaygroundFrame', () => {
  let fixture: ComponentFixture<Host>;
  let root: HTMLElement;

  const text = (selector: string) =>
    [...root.querySelectorAll(selector)].map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
  /** The state panel's rows: an attribute's name, then its value. */
  const attributes = () =>
    [...root.querySelectorAll('.pg-attribute')].map(
      (row) => `${row.querySelector('dt')?.textContent} ${row.querySelector('dd')?.textContent}`,
    );
  const settle = async () => {
    await fixture.whenStable();
    // The state panel reads the attributes off a MutationObserver.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    root = fixture.nativeElement as HTMLElement;
    await settle();
  });

  it('shows the subject’s state attributes, and follows them', async () => {
    expect(text('.pg-subject__label')).toEqual(['Button', 'Value']);
    expect(attributes()).toEqual(['aria-pressed false', 'data-label Press']);

    fixture.componentInstance.on.set(true);
    await settle();
    expect(attributes()).toContain('aria-pressed true');
    expect(root.querySelector('.pg-value')?.textContent).toContain('"on": true');
  });

  it('sets the playground’s signals from its knobs, and runs its actions', async () => {
    const input = root.querySelector<HTMLInputElement>('.pg-input')!;
    input.value = 'Go';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(fixture.componentInstance.label()).toBe('Go');
    expect(attributes()).toContain('data-label Go');

    root.querySelector<HTMLButtonElement>('.pg-action')!.click();
    await settle();
    expect(fixture.componentInstance.on()).toBe(true);
  });

  it('logs what the stage emits, newest first, until cleared', async () => {
    expect(text('.pg-events')).toEqual(['Nothing emitted yet']);
    const button = root.querySelector<HTMLButtonElement>('[playgroundSubject]')!;
    button.click();
    fixture.componentInstance.on.set(true);
    await settle();
    button.click();
    await settle();

    const events = text('.pg-event__name');
    expect(events).toEqual(['clicked', 'clicked']);
    expect(text('.pg-event__detail')).toEqual(['{"on":true}', '{"on":false}']);

    const clear = [...root.querySelectorAll<HTMLButtonElement>('.pg-panel--events button')][0];
    clear.click();
    await settle();
    expect(root.querySelectorAll('.pg-event__name').length).toBe(0);
  });
});
