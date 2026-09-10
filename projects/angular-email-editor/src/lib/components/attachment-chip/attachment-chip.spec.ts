import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Attachment } from './attachment';
import { ATTACHMENT_CHIP_OPTIONS, AttachmentChip, simulatedDuration } from './attachment-chip';

const MB = 1024 * 1024;
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One chip on its own, every state driven from the host the way a real
    upload loop would drive it — through the ARIA attributes. */
@Component({
  imports: [AttachmentChip],
  template: `<li
    email-attachment-chip
    [attachment]="attachment()"
    [removable]="removable()"
    [aria-busy]="busy()"
    [progress]="progress()"
    [aria-disabled]="disabled()"
    (removed)="removals = removals + 1"
  ></li>`,
})
class Host {
  readonly attachment = signal<Attachment>({
    name: 'Q4-report.pdf',
    type: 'application/pdf',
    size: 2.5 * MB,
  });
  readonly removable = signal(true);
  readonly busy = signal(false);
  readonly progress = signal<number | null>(null);
  readonly disabled = signal(false);
  removals = 0;
}

function slots(chip: HTMLElement) {
  return {
    name: () => chip.querySelector<HTMLElement>('[data-slot=name]')!,
    size: () => chip.querySelector<HTMLElement>('[data-slot=size]'),
    icon: () => chip.querySelector('[data-slot=icon] path')?.getAttribute('d'),
    remove: () => chip.querySelector<HTMLButtonElement>('[data-slot=remove]'),
    ring: () => chip.querySelector<SVGElement>('[role=progressbar]'),
  };
}

describe('AttachmentChip', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let chip: HTMLElement;
  let part: ReturnType<typeof slots>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    chip = (fixture.nativeElement as HTMLElement).querySelector('[email-attachment-chip]')!;
    part = slots(chip);
  });

  it('shows the name over the size, with the whole name in the title', () => {
    expect(part.name().textContent?.trim()).toBe('Q4-report.pdf');
    expect(part.name().title).toBe('Q4-report.pdf');
    expect(part.size()?.textContent?.trim()).toBe('2.5 MB');
  });

  it('leaves the size line out when the size is unknown', async () => {
    host.attachment.set({ name: 'mystery', type: 'application/pdf' });
    await fixture.whenStable();

    expect(part.size()).toBeNull();
  });

  it('names its kind on the host and draws that kind’s icon', async () => {
    expect(chip.dataset['kind']).toBe('pdf');
    const pdfIcon = part.icon();

    host.attachment.set({ name: 'photo.jpg', type: 'image/jpeg' });
    await fixture.whenStable();

    expect(chip.dataset['kind']).toBe('image');
    expect(part.icon()).toBeTruthy();
    expect(part.icon()).not.toBe(pdfIcon);
  });

  it('asks to be removed, once per press, without removing anything itself', async () => {
    part.remove()!.click();
    await fixture.whenStable();

    expect(host.removals).toBe(1);
    expect(part.name().textContent?.trim()).toBe('Q4-report.pdf');
  });

  it('labels the remove button with the file it drops', () => {
    expect(part.remove()?.getAttribute('aria-label')).toBe('Remove Q4-report.pdf');
  });

  it('drops the remove button but keeps the chip when not removable', async () => {
    host.removable.set(false);
    await fixture.whenStable();

    expect(part.remove()).toBeNull();
    expect(part.name().textContent?.trim()).toBe('Q4-report.pdf');
  });

  it('accepts a browser File unchanged — it already satisfies Attachment', async () => {
    host.attachment.set(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    await fixture.whenStable();

    expect(part.name().textContent?.trim()).toBe('notes.txt');
    expect(part.size()?.textContent?.trim()).toBe('1 B');
    expect(chip.dataset['kind']).toBe('document');
  });

  it('is idle by default: no aria-busy, no ring', () => {
    expect(chip.hasAttribute('aria-busy')).toBe(false);
    expect(part.ring()).toBeNull();
  });

  it('reflects aria-busy and draws the host’s number as a determinate ring', async () => {
    host.busy.set(true);
    host.progress.set(0.42);
    await fixture.whenStable();

    expect(chip.getAttribute('aria-busy')).toBe('true');
    expect(part.ring()?.dataset['mode']).toBe('determinate');
    expect(part.ring()?.getAttribute('aria-valuenow')).toBe('42');
    expect(part.ring()?.getAttribute('aria-label')).toBe('Uploading Q4-report.pdf');
  });

  it('spins without a number when busy with no progress', async () => {
    host.busy.set(true);
    await fixture.whenStable();

    expect(part.ring()?.dataset['mode']).toBe('indeterminate');
    expect(part.ring()?.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('clamps a progress value outside 0–1', async () => {
    host.busy.set(true);
    host.progress.set(1.7);
    await fixture.whenStable();

    expect(part.ring()?.getAttribute('aria-valuenow')).toBe('100');
  });

  it('reflects aria-disabled and takes the remove button out of play', async () => {
    host.disabled.set(true);
    await fixture.whenStable();

    expect(chip.getAttribute('aria-disabled')).toBe('true');
    expect(part.remove()?.disabled).toBe(true);
  });

  it('marks every part with a data-slot', () => {
    const names = [...chip.querySelectorAll('[data-slot]')].map((el) =>
      el.getAttribute('data-slot'),
    );
    expect(names).toEqual(['icon', 'label', 'name', 'size', 'remove']);
  });
});

describe('AttachmentChip slots', () => {
  @Component({
    imports: [AttachmentChip],
    template: `<li email-attachment-chip [attachment]="attachment" aria-busy>
      <b data-slot="icon">★</b>
      <i data-slot="progress">42%</i>
    </li>`,
  })
  class SlottedHost {
    readonly attachment: Attachment = { name: 'x.pdf', type: 'application/pdf' };
  }

  it('replaces the default icon and ring with what the host projects', async () => {
    await TestBed.configureTestingModule({ imports: [SlottedHost] }).compileComponents();
    const fixture = TestBed.createComponent(SlottedHost);
    await fixture.whenStable();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('[email-attachment-chip]')!;

    expect(chip.querySelector('b[data-slot=icon]')?.textContent).toBe('★');
    expect(chip.querySelector('svg[data-slot=icon]')).toBeNull();
    expect(chip.querySelector('i[data-slot=progress]')?.textContent).toBe('42%');
    expect(chip.querySelector('[role=progressbar]')).toBeNull();
    // The bare `aria-busy` attribute is the input, and the chip reflects it.
    expect(chip.getAttribute('aria-busy')).toBe('true');
  });
});

describe('AttachmentChip simulateProgress', () => {
  @Component({
    imports: [AttachmentChip],
    template: `<li
      email-attachment-chip
      [attachment]="attachment"
      simulateProgress
      [aria-busy]="busy()"
      [progress]="progress()"
    ></li>`,
  })
  class SimulatedHost {
    readonly attachment: Attachment = { name: 'a.pdf', type: 'application/pdf', size: MB };
    readonly busy = signal(false);
    readonly progress = signal<number | null>(null);
  }

  let fixture: ComponentFixture<SimulatedHost>;
  const chip = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[email-attachment-chip]')!;
  const ring = () => chip().querySelector<SVGElement>('[role=progressbar]');

  async function create(configure?: (host: SimulatedHost) => void) {
    await TestBed.configureTestingModule({
      imports: [SimulatedHost],
      providers: [
        {
          provide: ATTACHMENT_CHIP_OPTIONS,
          useValue: { minDuration: 20, maxDuration: 20, fallbackDuration: 20 },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SimulatedHost);
    configure?.(fixture.componentInstance);
    await fixture.whenStable();
  }

  afterEach(() => vi.unstubAllGlobals());

  it('is busy while the fake runs, announces no number, then settles on its own', async () => {
    await create();

    expect(chip().getAttribute('aria-busy')).toBe('true');
    expect(ring()?.dataset['mode']).toBe('simulated');
    expect(ring()?.hasAttribute('aria-valuenow')).toBe(false);

    await settle(40);
    await fixture.whenStable();

    expect(chip().hasAttribute('aria-busy')).toBe(false);
    expect(ring()).toBeNull();
  });

  it('gives way to real progress from the host', async () => {
    await create((host) => {
      host.busy.set(true);
      host.progress.set(0.3);
    });

    expect(ring()?.dataset['mode']).toBe('determinate');
    expect(ring()?.getAttribute('aria-valuenow')).toBe('30');
  });

  it('is skipped entirely for reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    await create();

    expect(chip().hasAttribute('aria-busy')).toBe(false);
    expect(ring()).toBeNull();
  });
});

describe('simulatedDuration', () => {
  const options = {
    bytesPerSecond: 10 * MB,
    minDuration: 400,
    maxDuration: 3000,
    fallbackDuration: 800,
  };

  it('paces by size over the assumed speed', () => {
    expect(simulatedDuration(10 * MB, options)).toBe(1000);
  });

  it('clamps tiny and huge files to the floor and ceiling', () => {
    expect(simulatedDuration(2048, options)).toBe(400);
    expect(simulatedDuration(500 * MB, options)).toBe(3000);
  });

  it('uses the fallback when the size is unknown', () => {
    expect(simulatedDuration(undefined, options)).toBe(800);
  });
});
