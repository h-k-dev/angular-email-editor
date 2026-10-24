/**
 * The chip's real layout — `npm run test:render`, in real Chromium (jsdom has
 * no layout, so the everyday `ng test` skips this file): the 40px geometry
 * with its 8px inset, a long name cut in its stem and never its extension,
 * the failed look, the bar filling from the reading side, and the fills
 * that survive forced colours.
 */
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { cdp, userEvent } from 'vitest/browser';
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
        [preview]="preview()"
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
  readonly preview = signal<string | null>(null);
}

/** WCAG's relative luminance of an `rgb()` / `rgba()` colour. */
function luminance([r, g, b]: readonly number[]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function rgb(colour: string): number[] {
  return colour.match(/[\d.]+/g)!.slice(0, 3).map(Number);
}

function contrast(a: readonly number[], b: readonly number[]): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** A one-colour PNG, as a data URL. */
function swatch(colour: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const context = canvas.getContext('2d')!;
  context.fillStyle = colour;
  context.fillRect(0, 0, 8, 8);
  return canvas.toDataURL('image/png');
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

  it('gives the × the whole end square as its target, and the retry the start one when failed', async () => {
    /** The chip's control under a point, if any. */
    const at = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest('[data-slot]')?.getAttribute('data-slot');
    const outer = box(chip());
    const end = box(part('trailing'));
    const name = box(part('name'));

    // Every corner of the end square, inside the border, and the gap before it.
    for (const [x, y] of [
      [outer.right - 2, outer.top + 2],
      [outer.right - 2, outer.bottom - 2],
      [end.left - 7, outer.top + 2],
      [end.left - 7, outer.bottom - 2],
    ]) {
      expect(at(x, y)).toBe('remove');
    }
    // The name is the name's, right up to the target.
    expect(at(name.right - 1, name.top + name.height / 2)).not.toBe('remove');
    // The start square is no target while nothing there acts.
    expect(at(outer.left + 2, outer.top + 2)).not.toBe('remove');

    fixture.componentInstance.status.set('failed');
    await settle();
    const start = box(part('leading'));
    for (const [x, y] of [
      [outer.left + 2, outer.top + 2],
      [outer.left + 2, outer.bottom - 2],
      [start.right + 7, outer.top + 2],
    ]) {
      expect(at(x, y)).toBe('retry');
    }
    expect(at(outer.right - 2, outer.top + 2)).toBe('remove');
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

  for (const scheme of ['light', 'dark'] as const) {
    it(`keeps every line at AAA and the icons over 3:1 above an image’s worst pixel (${scheme})`, async () => {
      // The page the chip sits on, Material's surface; the worst pixel is
      // the one nearest the ink — black under light, white under dark.
      const surface = scheme === 'light' ? [255, 255, 255] : [19, 19, 20];
      const worst = scheme === 'light' ? [0, 0, 0] : [255, 255, 255];
      root().style.colorScheme = scheme;
      root().style.background = `rgb(${surface.join(',')})`;
      fixture.componentInstance.attachment.set({ name: 'photo.jpg', type: 'image/jpeg', size: 2048 });
      fixture.componentInstance.preview.set(swatch(`rgb(${worst.join(',')})`));
      await settle();
      const preview = part('preview') as HTMLImageElement;
      await preview.decode();
      await settle();

      // What the eye gets behind the text: the pixel at the picture's
      // opacity over the surface.
      const alpha = Number(getComputedStyle(preview).opacity);
      expect(alpha).toBeGreaterThan(0);
      const behind = surface.map((value, i) => value * (1 - alpha) + worst[i] * alpha);
      const ink = (slot: string) => rgb(getComputedStyle(part(slot)).color);

      for (const slot of ['name', 'size']) {
        expect(contrast(ink(slot), behind)).toBeGreaterThanOrEqual(7);
      }
      for (const slot of ['icon', 'remove']) {
        expect(contrast(ink(slot), behind)).toBeGreaterThanOrEqual(3);
      }

      fixture.componentInstance.status.set('failed');
      await settle();
      expect(contrast(ink('error'), behind)).toBeGreaterThanOrEqual(7);
      expect(contrast(ink('retry'), behind)).toBeGreaterThanOrEqual(3);
    });
  }

  it('dims the picture to half under the pointer or focus — a fade only, never a filter', async () => {
    fixture.componentInstance.attachment.set({ name: 'photo.jpg', type: 'image/jpeg', size: 2048 });
    fixture.componentInstance.preview.set(swatch('rgb(200, 30, 30)'));
    await settle();
    const preview = () => getComputedStyle(part('preview'));
    /** The picture's opacity, its fade skipped to the end. */
    const opacity = async () => {
      await frame();
      part('preview').getAnimations().forEach((animation) => animation.finish());
      return Number(preview().opacity);
    };

    expect(await opacity()).toBe(0.2);
    // What is transitioned is opacity and nothing else: smooth without a GPU.
    expect(preview().transitionProperty).toBe('opacity');
    expect(preview().filter).toBe('none');

    await userEvent.hover(chip());
    expect(await opacity()).toBe(0.1);
    expect(preview().filter).toBe('none');

    await userEvent.unhover(chip());
    expect(await opacity()).toBe(0.2);

    part('remove').focus();
    expect(await opacity()).toBe(0.1);
    part('remove').blur();
    expect(await opacity()).toBe(0.2);

    const session = cdp() as unknown as {
      send(method: string, params: object): Promise<unknown>;
    };
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    try {
      await settle();
      expect(preview().transitionDuration).toBe('0s');
    } finally {
      await session.send('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  it('lays the preview under the content, inside the corner, and drops it under forced colours', async () => {
    fixture.componentInstance.attachment.set({ name: 'photo.jpg', type: 'image/jpeg', size: 2048 });
    fixture.componentInstance.preview.set(swatch('rgb(200, 30, 30)'));
    await settle();
    const preview = part('preview');
    const outer = box(chip());
    const inner = box(preview);

    expect(getComputedStyle(preview).zIndex).toBe('-1');
    expect(getComputedStyle(chip()).isolation).toBe('isolate');
    // Inside the 1px border, all round.
    expect([inner.left - outer.left, outer.right - inner.right]).toEqual([1, 1]);
    expect([inner.top - outer.top, outer.bottom - inner.bottom]).toEqual([1, 1]);
    // The name, not the picture, is what a point over the label finds.
    const label = box(part('name'));
    expect(
      document.elementFromPoint(label.left + 4, label.top + label.height / 2)?.closest('[data-slot=name]'),
    ).toBeTruthy();

    const session = cdp() as unknown as {
      send(method: string, params: object): Promise<unknown>;
    };
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    try {
      await settle();
      expect(getComputedStyle(part('preview')).display).toBe('none');
    } finally {
      await session.send('Emulation.setEmulatedMedia', { features: [] });
    }
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
