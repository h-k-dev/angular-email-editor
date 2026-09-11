import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Attachment, AttachmentStatus } from './attachment';
import { ATTACHMENT_CHIP_OPTIONS, AttachmentChip, simulatedDuration } from './attachment-chip';
import { AttachmentChipIcon, AttachmentChipProgress } from './attachment-chip.slots';

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
    [status]="status()"
    [aria-busy]="busy()"
    [progress]="progress()"
    [progressLabel]="progressLabel()"
    [aria-disabled]="disabled()"
    (removed)="removals = removals + 1"
  ></li>`,
})
class Host {
  readonly status = signal<AttachmentStatus | null>(null);
  readonly progressLabel = signal<string | undefined>(undefined);
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
    progress: () => chip.querySelector<HTMLElement>('[role=progressbar]'),
    bar: () => chip.querySelector<HTMLElement>('[data-slot=progress-indicator]'),
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

  it('is idle by default: no aria-busy, no mode, no progress', () => {
    expect(chip.hasAttribute('aria-busy')).toBe(false);
    expect(chip.hasAttribute('data-mode')).toBe(false);
    expect(part.progress()).toBeNull();
  });

  it('reflects aria-busy and draws the host’s number as a determinate bar with a readout', async () => {
    host.busy.set(true);
    host.progress.set(0.42);
    await fixture.whenStable();

    expect(chip.getAttribute('aria-busy')).toBe('true');
    expect(chip.dataset['mode']).toBe('determinate');
    expect(part.progress()?.dataset['mode']).toBe('determinate');
    expect(part.progress()?.getAttribute('aria-valuenow')).toBe('42');
    expect(part.progress()?.getAttribute('aria-label')).toBe('Uploading Q4-report.pdf');
    expect(part.progress()?.textContent?.trim()).toBe('42%');
    expect(part.bar()?.style.transform).toBe('scaleX(0.42)');
  });

  it('scans without a number when busy with no progress: the mode on the host, an empty readout', async () => {
    host.busy.set(true);
    await fixture.whenStable();

    expect(chip.dataset['mode']).toBe('indeterminate');
    expect(chip.dataset['scanning']).toBe('true');
    expect(part.progress()?.dataset['mode']).toBe('indeterminate');
    expect(part.progress()?.hasAttribute('aria-valuenow')).toBe(false);
    expect(part.progress()?.textContent?.trim()).toBe('');
    expect(part.progress()?.querySelector('[data-slot=progress-value]')).toBeNull();
    expect(part.bar()?.style.transform).toBe('');
  });

  it('sweeps while preprocessing, named for the stage', async () => {
    host.status.set('preprocessing');
    await fixture.whenStable();

    expect(chip.getAttribute('aria-busy')).toBe('true');
    expect(chip.dataset['status']).toBe('preprocessing');
    expect(chip.dataset['mode']).toBe('indeterminate');
    expect(chip.dataset['scanning']).toBe('true');
    expect(part.progress()?.getAttribute('aria-label')).toBe('Preparing Q4-report.pdf');
    expect(part.progress()?.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('fills while uploading with a number, and sweeps while uploading without one', async () => {
    host.status.set('uploading');
    host.progress.set(0.42);
    await fixture.whenStable();

    expect(chip.dataset['mode']).toBe('determinate');
    expect(part.progress()?.getAttribute('aria-label')).toBe('Uploading Q4-report.pdf');
    expect(part.progress()?.getAttribute('aria-valuenow')).toBe('42');

    host.progress.set(null);
    await fixture.whenStable();
    expect(chip.dataset['mode']).toBe('indeterminate');
  });

  it('keeps quiet while queued: busy and announced as waiting, with no bar and no sweep', async () => {
    host.status.set('queued');
    await fixture.whenStable();

    expect(chip.getAttribute('aria-busy')).toBe('true');
    expect(chip.dataset['status']).toBe('queued');
    expect(chip.dataset['mode']).toBe('queued');
    expect(chip.hasAttribute('data-scanning')).toBe(false);
    expect(part.progress()?.getAttribute('aria-label')).toBe('Waiting to upload Q4-report.pdf');
    expect(part.progress()?.hasAttribute('aria-valuenow')).toBe(false);
    expect(part.progress()?.textContent?.trim()).toBe('');
    expect(part.bar()).toBeNull();

    // Its turn comes: the bar appears, and no band ever had to leave.
    host.status.set('uploading');
    host.progress.set(0.2);
    await fixture.whenStable();
    expect(chip.dataset['mode']).toBe('determinate');
    expect(chip.hasAttribute('data-scanning')).toBe(false);
    expect(part.bar()).not.toBeNull();
  });

  it('sweeps while postprocessing, and is idle once complete', async () => {
    host.status.set('postprocessing');
    await fixture.whenStable();

    expect(chip.dataset['mode']).toBe('indeterminate');
    expect(part.progress()?.getAttribute('aria-label')).toBe('Processing Q4-report.pdf');

    host.status.set('complete');
    await fixture.whenStable();
    expect(chip.hasAttribute('aria-busy')).toBe(false);
    expect(chip.dataset['status']).toBe('complete');
    expect(part.progress()).toBeNull();
  });

  it('lets the host name the progress over the stage', async () => {
    host.status.set('preprocessing');
    host.progressLabel.set('Scanning');
    await fixture.whenStable();

    expect(part.progress()?.getAttribute('aria-label')).toBe('Scanning Q4-report.pdf');
  });

  it('lets the scanning band leave for a moment once the number arrives', async () => {
    host.status.set('preprocessing');
    await fixture.whenStable();
    expect(chip.dataset['scanning']).toBe('true');

    host.status.set('uploading');
    host.progress.set(0.1);
    await fixture.whenStable();
    expect(chip.dataset['mode']).toBe('determinate');
    expect(chip.dataset['scanning']).toBe('leaving');

    await settle(350);
    await fixture.whenStable();
    expect(chip.hasAttribute('data-scanning')).toBe(false);
  });

  it('never enters the leaving state when the number was there from the start', async () => {
    host.progress.set(0.1);
    host.busy.set(true);
    await fixture.whenStable();

    expect(chip.dataset['mode']).toBe('determinate');
    expect(chip.hasAttribute('data-scanning')).toBe(false);
  });

  it('keeps the readout and the remove button in the shared trailing square', async () => {
    host.busy.set(true);
    await fixture.whenStable();

    const trailing = chip.querySelector('[data-slot=trailing]')!;
    expect(trailing.contains(part.progress())).toBe(true);
    expect(trailing.contains(part.remove())).toBe(true);
    expect(trailing.contains(part.bar())).toBe(true);
  });

  it('clamps a progress value outside 0–1', async () => {
    host.busy.set(true);
    host.progress.set(1.7);
    await fixture.whenStable();

    expect(part.progress()?.getAttribute('aria-valuenow')).toBe('100');
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
    expect(names).toEqual(['icon', 'label', 'name', 'size', 'trailing', 'remove']);
  });
});

describe('AttachmentChip slots', () => {
  @Component({
    imports: [AttachmentChip, AttachmentChipIcon, AttachmentChipProgress],
    template: `<li
      email-attachment-chip
      [attachment]="attachment"
      status="uploading"
      [progress]="0.42"
    >
      <b *emailAttachmentIcon="let file; let kind = kind">{{ kind }}:{{ file.name }}</b>
      <ng-template emailAttachmentProgress let-file let-percent="percent" let-mode="mode">
        <i>{{ mode }} {{ percent }} {{ file.name }}</i>
      </ng-template>
    </li>`,
  })
  class SlottedHost {
    readonly attachment: Attachment = { name: 'x.pdf', type: 'application/pdf' };
  }

  it('renders the host’s templates inside the boxes it sizes, with the chip’s context', async () => {
    await TestBed.configureTestingModule({ imports: [SlottedHost] }).compileComponents();
    const fixture = TestBed.createComponent(SlottedHost);
    await fixture.whenStable();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('[email-attachment-chip]')!;

    // The icon box is the chip's; the host's element is inside it, and the
    // default glyph is not.
    expect(chip.querySelector('[data-slot=icon] > b')?.textContent).toBe('pdf:x.pdf');
    expect(chip.querySelector('[data-slot=icon] svg')).toBeNull();

    // The readout keeps its role and number; only what it shows is the host's.
    const readout = chip.querySelector('[role=progressbar]')!;
    expect(readout.getAttribute('aria-valuenow')).toBe('42');
    expect(readout.querySelector('i')?.textContent?.trim()).toBe('determinate 42 x.pdf');
    expect(readout.querySelector('[data-slot=progress-value]')).toBeNull();

    // The bar and the trailing square are untouched.
    expect(chip.querySelector('[data-slot=trailing] [data-slot=progress-track]')).not.toBeNull();
    expect(chip.querySelector('[data-slot=trailing] [data-slot=remove]')).not.toBeNull();
  });

  it('keeps a bare aria-busy attribute as the input, and reflects it', async () => {
    @Component({
      imports: [AttachmentChip],
      template: `<li email-attachment-chip [attachment]="attachment" aria-busy></li>`,
    })
    class BareHost {
      readonly attachment: Attachment = { name: 'x.pdf' };
    }
    await TestBed.configureTestingModule({ imports: [BareHost] }).compileComponents();
    const fixture = TestBed.createComponent(BareHost);
    await fixture.whenStable();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('[email-attachment-chip]')!;

    expect(chip.getAttribute('aria-busy')).toBe('true');
    expect(chip.querySelector('[role=progressbar]')).not.toBeNull();
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
  const ring = () => chip().querySelector<HTMLElement>('[role=progressbar]');

  async function create(configure?: (host: SimulatedHost) => void) {
    await TestBed.configureTestingModule({
      imports: [SimulatedHost],
      providers: [
        {
          provide: ATTACHMENT_CHIP_OPTIONS,
          useValue: { minDuration: 20, maxDuration: 20, fallbackDuration: 20, linger: 60 },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SimulatedHost);
    configure?.(fixture.componentInstance);
    await fixture.whenStable();
  }

  afterEach(() => vi.unstubAllGlobals());

  it('is busy while the fake runs, announces no number, lingers full, then settles on its own', async () => {
    await create();

    expect(chip().getAttribute('aria-busy')).toBe('true');
    expect(ring()?.dataset['mode']).toBe('simulated');
    expect(ring()?.hasAttribute('aria-valuenow')).toBe(false);

    // The fill is done, and the full bar is still on show.
    await settle(40);
    await fixture.whenStable();
    expect(chip().getAttribute('aria-busy')).toBe('true');

    await settle(60);
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
