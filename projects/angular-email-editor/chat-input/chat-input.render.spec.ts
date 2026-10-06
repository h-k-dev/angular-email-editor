/**
 * The chat input's growing — `npm run test:render`, in real Chromium (jsdom
 * has no layout and no ResizeObserver, so the everyday `ng test` skips this
 * file). The box follows its text's height through a transition, both ways;
 * the text grows to five lines, then scrolls inside the box, which never does.
 * The page carries the host's editor styles, as the app's styles.scss has
 * them (`.aee-editor`: the full height, an email's width) — the field must
 * size to its text despite them.
 */
import { Component, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatInput } from './chat-input';

@Component({
  imports: [ChatInput],
  template: `<div email-chat-input #input style="width: 240px"></div>`,
})
class Host {
  readonly input = viewChild.required<ChatInput>('input');
}

describe('ChatInput (render)', () => {
  let fixture: ComponentFixture<Host>;

  const box = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[email-chat-input]')!;
  const height = () => box().getBoundingClientRect().height;
  const text = () => box().querySelector<HTMLElement>('.email-chat-input__editor')!;
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  /** Puts `count` more lines in, through the editor: a hard break each. */
  const lines = (count: number) => {
    const view = fixture.componentInstance.input().editor()!.view;
    for (let i = 0; i < count; i++) {
      const tr = view.state.tr;
      if (view.state.doc.textContent) tr.replaceSelectionWith(view.state.schema.nodes['hardBreak'].create());
      view.dispatch(tr.insertText(`line ${i}`));
    }
  };

  /** The host's global editor surface — a page's sizing, not a field's. */
  let hostStyles: HTMLStyleElement;

  beforeEach(async () => {
    hostStyles = document.createElement('style');
    hostStyles.textContent = '.aee-editor { display: block; height: 100%; box-sizing: border-box; max-width: 600px; }';
    document.head.appendChild(hostStyles);
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    await frame();
    await frame();
  });

  afterEach(() => {
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
    hostStyles.remove();
  });

  it('grows with its text through a transition, and shrinks back', async () => {
    const one = height();
    expect(one).toBeGreaterThan(0);

    lines(3);
    await frame();
    await wait(60);
    const between = height();
    await wait(250);
    const three = height();

    expect(three).toBeGreaterThan(one + 20);
    // Caught on the way: neither where it was nor where it ends.
    expect(between).toBeGreaterThan(one);
    expect(between).toBeLessThan(three);
    // Settled exactly on the text: nothing to scroll.
    expect(box().scrollHeight).toBeLessThanOrEqual(box().clientHeight);
    expect(getComputedStyle(box()).overflowY).toBe('hidden');

    fixture.componentInstance.input().clear();
    await frame();
    await wait(60);
    const back = height();
    await wait(250);
    expect(back).toBeLessThan(three);
    expect(back).toBeGreaterThan(one);
    expect(height()).toBeCloseTo(one, 0);
  });

  it('grows to five lines, then the text scrolls inside the box', async () => {
    lines(1);
    await frame();
    await wait(300);
    const line = text().getBoundingClientRect().height;
    lines(11);
    await frame();
    await wait(300);
    expect(text().getBoundingClientRect().height).toBeCloseTo(5 * line, 0);
    expect(text().scrollHeight).toBeGreaterThan(text().clientHeight);
    // The box holds the five lines exactly, and never scrolls itself.
    expect(box().scrollHeight).toBeLessThanOrEqual(box().clientHeight);
    expect(getComputedStyle(box()).overflowY).toBe('hidden');
  });

  it('takes its cap from --email-chat-input-max-height', async () => {
    box().style.setProperty('--email-chat-input-max-height', '60px');
    lines(12);
    await frame();
    await wait(300);
    expect(text().getBoundingClientRect().height).toBeCloseTo(60, 0);
  });
});
