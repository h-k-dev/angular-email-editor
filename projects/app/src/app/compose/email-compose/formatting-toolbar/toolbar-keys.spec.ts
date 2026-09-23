import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ToolbarKeys } from './toolbar-keys';

@Component({
  imports: [ToolbarKeys],
  template: `
    <div role="toolbar" appToolbarKeys [attr.dir]="dir()">
      <button class="a"></button>
      <button class="b" disabled></button>
      <button class="c"></button>
    </div>
  `,
})
class Host {
  readonly dir = signal<'ltr' | 'rtl'>('ltr');
}

describe('ToolbarKeys', () => {
  const setup = async (dir: 'ltr' | 'rtl') => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.dir.set(dir);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const button = (name: string) => root.querySelector<HTMLButtonElement>(`.${name}`)!;
    const press = (from: HTMLElement, key: string) => {
      from.focus();
      from.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      return document.activeElement;
    };
    return { button, press, done: () => root.remove() };
  };

  it('moves with the arrows, passing over a disabled tool', async () => {
    const { button, press, done } = await setup('ltr');
    expect(press(button('a'), 'ArrowRight')).toBe(button('c'));
    expect(press(button('c'), 'ArrowRight')).toBe(button('a'));
    expect(press(button('a'), 'End')).toBe(button('c'));
    done();
  });

  it('follows the reading direction: in right-to-left, Left is the next tool', async () => {
    const { button, press, done } = await setup('rtl');
    expect(press(button('a'), 'ArrowLeft')).toBe(button('c'));
    expect(press(button('c'), 'ArrowRight')).toBe(button('a'));
    done();
  });
});
