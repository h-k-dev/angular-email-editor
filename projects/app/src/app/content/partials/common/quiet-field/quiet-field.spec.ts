import { FocusMonitor } from '@angular/cdk/a11y';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { QuietField } from './quiet-field';

@Component({
  imports: [QuietField],
  template: `
    <input quietField placeholder="Add location" />
    <textarea quietField></textarea>
  `,
})
class Host {}

describe('QuietField', () => {
  const start = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    return {
      input: root.querySelector('input')!,
      textarea: root.querySelector('textarea')!,
      focus: TestBed.inject(FocusMonitor),
    };
  };

  it('wears the look’s class, on inputs and text areas alike', async () => {
    const { input, textarea } = await start();
    expect(input.classList).toContain('quiet-field');
    expect(textarea.classList).toContain('quiet-field');
  });

  it('says how focus came: keyboard (the ring), or a click (none)', async () => {
    const { input, textarea, focus } = await start();
    focus.focusVia(input, 'keyboard');
    expect(input.classList).toContain('cdk-keyboard-focused');

    focus.focusVia(textarea, 'mouse');
    expect(textarea.classList).toContain('cdk-mouse-focused');
    expect(textarea.classList).not.toContain('cdk-keyboard-focused');
    // The field left behind forgets how it was reached.
    expect(input.classList).not.toContain('cdk-keyboard-focused');
  });
});
