/**
 * The chip's real layout — `npm run test:render`, in real Chromium (jsdom has
 * no layout, so the everyday `ng test` skips this file): the 40px geometry
 * with its 8px inset, a long name cut in its stem and never its extension,
 * the failed look, the bar filling from the reading side, and the fills
 * that survive forced colours.
 */
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { cdp } from 'vitest/browser';
import { Attachment, AttachmentStatus } from './attachment';
import { AttachmentChip } from './attachment-chip';

@Component({
  imports: [AttachmentChip],
  template: `<div [attr.dir]="dir()">
    <ul style="list-style: none; margin: 0; padding: 0">
      <li
        email-attachment-chip
        [attachment]="attachment()"
        [status]="status()"
        [progress]="progress()"
      ></li>
    </ul>
  </div>`,
})
class Host {
  readonly dir = signal<'ltr' | 'rtl'>('ltr');
  readonly attachment = signal<Attachment>({
    name: 'Q4-report.pdf',
    type: 'application/pdf',
    size: 2048,
  });
  readonly status = signal<AttachmentStatus | null>(null);
  readonly progress = signal<number | null>(null);
}

describe('AttachmentChip (render)', () => {
  let fixture: ComponentFixture<Host>;

  const root = () => fixture.nativeElement as HTMLElement;
  const chip = () => root().querySelector<HTMLElement>('[email-attachment-chip]')!;
  const part = (slot: string) => chip().querySelector<HTMLElement>(`[data-slot='${slot}']`)!;
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  /** Settled, with every transition and animation skipped to its end. */
  const settle = async () => {
    await fixture.whenStable();
    await frame();
    chip()
      .getAnimations({ subtree: true })
      .forEach((animation) => animation.finish());
  };
  const box = (element: HTMLElement) => element.getBoundingClientRect();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    root().style.padding = '24px';
    document.body.appendChild(root());
    await settle();
  });

  afterEach(() => root().remove());

  it('is 40px tall, its two squares 24px and 8px from every edge they face', () => {
    const outer = box(chip());
    const leading = box(part('leading'));
    const trailing = box(part('trailing'));

    expect(outer.height).toBe(40);
    for (const square of [leading, trailing]) {
      expect([square.width, square.height]).toEqual([24, 24]);
      expect(square.top - outer.top).toBe(8);
      expect(outer.bottom - square.bottom).toBe(8);
    }
    expect(leading.left - outer.left).toBe(8);
    expect(outer.right - trailing.right).toBe(8);
  });

  it('cuts a long name in its stem and keeps the extension whole, beside it', async () => {
    fixture.componentInstance.attachment.set({
      name: 'A very long quarterly financial report for the board.pdf',
      type: 'application/pdf',
      size: 2048,
    });
    await settle();
    const stem = part('name-stem');
    const extension = part('name-extension');

    expect(box(chip()).width).toBe(240);
    expect(stem.scrollWidth).toBeGreaterThan(stem.clientWidth);
    expect(extension.scrollWidth).toBe(extension.clientWidth);
    expect(extension.textContent).toBe('.pdf');
    expect(Math.round(box(extension).left)).toBe(Math.round(box(stem).right));
    expect(box(extension).right).toBeLessThanOrEqual(box(part('name')).right);
  });

  it('when failed, shows the retry in the icon’s place without a hover, and the error colour', async () => {
    fixture.componentInstance.status.set('failed');
    await settle();

    expect(getComputedStyle(part('icon-button')).opacity).toBe('1');
    expect(getComputedStyle(part('icon')).opacity).toBe('0');
    // No theme here: the hardcoded light-scheme error.
    const error = 'rgb(179, 38, 30)';
    expect(getComputedStyle(chip()).borderTopColor).toBe(error);
    expect(getComputedStyle(part('retry')).color).toBe(error);
    expect(getComputedStyle(part('error')).color).toBe(error);
  });

  it('fills the bar from the reading side: the left, or the right in a right-to-left page', async () => {
    fixture.componentInstance.status.set('uploading');
    fixture.componentInstance.progress.set(0.5);
    await settle();
    const originX = () => parseFloat(getComputedStyle(part('progress-indicator')).transformOrigin);
    // The layout width, unscaled and unrounded — the bar is scaled to its
    // number, and offsetWidth rounds.
    const width = () => parseFloat(getComputedStyle(part('progress-indicator')).width);

    expect(originX()).toBe(0);

    fixture.componentInstance.dir.set('rtl');
    await settle();
    expect(originX()).toBe(width());
  });

  it('keeps the bar and its track in system colours under forced colours', async () => {
    fixture.componentInstance.status.set('uploading');
    fixture.componentInstance.progress.set(0.5);
    await settle();
    // Chromium's DevTools protocol: the media emulation Playwright's page has,
    // from inside the test. The provider types it; the one call is enough.
    const session = cdp() as unknown as {
      send(method: string, params: object): Promise<unknown>;
    };
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    try {
      await settle();
      expect(matchMedia('(forced-colors: active)').matches).toBe(true);
      const transparent = 'rgba(0, 0, 0, 0)';
      for (const slot of ['progress-indicator', 'progress-track']) {
        const style = getComputedStyle(part(slot));
        expect(style.forcedColorAdjust).toBe('none');
        expect(style.backgroundColor).not.toBe(transparent);
      }
      expect(getComputedStyle(part('progress-indicator')).backgroundColor).not.toBe(
        getComputedStyle(part('progress-track')).backgroundColor,
      );
    } finally {
      await session.send('Emulation.setEmulatedMedia', { features: [] });
    }
  });
});
