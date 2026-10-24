/**
 * The attachment strip on the compose page, in real Chromium —
 * `npm run test:render` (jsdom has no layout and no ResizeObserver): the
 * rows switch runs the strip's height straight from the one to the other —
 * never past the end, never first the wrong way — and the strip never
 * reaches past the sheet's sides.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Compose } from './compose';
import { EMAIL_SEND_LATENCY } from '../../../core/email/email-send';

describe('Attachment strip (render)', () => {
  let fixture: ComponentFixture<Compose>;
  let sheet: any;

  const host = () => fixture.nativeElement as HTMLElement;
  const strip = () => host().querySelector<HTMLElement>('.attachment-strip')!;
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  /** The strip's height, every frame, until the switch has let go. */
  const heightsAcrossSwitch = async (): Promise<number[]> => {
    sheet.toggleAttachmentRows();
    fixture.detectChanges();
    const heights: number[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 400) {
      await frame();
      heights.push(Math.round(strip().getBoundingClientRect().height * 10) / 10);
    }
    return heights;
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Compose],
      providers: [{ provide: EMAIL_SEND_LATENCY, useValue: 0 }],
    });
    fixture = TestBed.createComponent(Compose);
    host().style.cssText = 'display: block; inline-size: 700px; block-size: 700px';
    document.body.append(host());
    await fixture.whenStable();
    sheet = (fixture.componentInstance as any).sheet();
    const refs = Array.from({ length: 9 }, (_, i) =>
      sheet.uploads.start({ name: `quarterly-report-${i + 1}.pdf`, size: 1000 * (i + 1) }),
    );
    sheet.message.update((m: object) => ({ ...m, attachments: refs }));
    // The runner's viewport is a phone's, whose sheet starts with the strip
    // put away (`MobileMessageForm`): out, as the toggle beside Attach puts
    // it, so there are rows to switch.
    if (sheet.attachmentsHidden()) sheet.toggleAttachments();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterEach(() => host().remove());

  it('runs its height straight across the rows switch, both ways', async () => {
    const one = strip().getBoundingClientRect().height;

    // The first frame is read before the observer holds the old height:
    // the motion is from the second on.
    const up = (await heightsAcrossSwitch()).slice(1);
    const two = strip().getBoundingClientRect().height;
    expect(two).toBeGreaterThan(one + 30);
    for (let i = 1; i < up.length; i++) expect(up[i]).toBeGreaterThanOrEqual(up[i - 1]);
    expect(Math.max(...up)).toBeLessThanOrEqual(two + 0.5);
    expect(Math.min(...up)).toBeGreaterThanOrEqual(one - 0.5);

    const down = (await heightsAcrossSwitch()).slice(1);
    for (let i = 1; i < down.length; i++) expect(down[i]).toBeLessThanOrEqual(down[i - 1]);
    expect(Math.max(...down)).toBeLessThanOrEqual(two + 0.5);
    expect(Math.min(...down)).toBeGreaterThanOrEqual(one - 0.5);
    expect(strip().getBoundingClientRect().height).toBeCloseTo(one, 0);
  });

  it('never reaches past the sheet’s sides', () => {
    for (let el: HTMLElement | null = strip(); el && el !== host(); el = el.parentElement) {
      expect(el.scrollWidth, el.className).toBeLessThanOrEqual(el.clientWidth);
    }
  });
});
