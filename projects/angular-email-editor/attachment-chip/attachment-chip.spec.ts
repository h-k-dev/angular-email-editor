import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Attachment, AttachmentStatus } from './attachment';
import { ATTACHMENT_CHIP_OPTIONS, AttachmentChip, simulatedDuration } from './attachment-chip';
import {
  AttachmentChipIcon,
  AttachmentChipIconButton,
  AttachmentChipTailButton,
  AttachmentChipProgress,
} from './attachment-chip.slots';

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
    [downloadable]="downloadable()"
    [activatable]="activatable()"
    [status]="status()"
    [aria-busy]="busy()"
    [progress]="progress()"
    [progressLabel]="progressLabel()"
    [aria-disabled]="disabled()"
    [isImage]="isImage()"
    [preview]="preview()"
    (removed)="removals = removals + 1"
    (downloaded)="downloads = downloads + 1"
    (activated)="activations = activations + 1"
    (retried)="retries = retries + 1"
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
  readonly downloadable = signal(false);
  readonly activatable = signal(false);
  readonly busy = signal(false);
  readonly progress = signal<number | null>(null);
  readonly disabled = signal(false);
  readonly isImage = signal<boolean | undefined>(undefined);
  readonly preview = signal<string | null>(null);
  removals = 0;
  downloads = 0;
  activations = 0;
  retries = 0;
}

function slots(chip: HTMLElement) {
  return {
    name: () => chip.querySelector<HTMLElement>('[data-slot=name]')!,
    stem: () => chip.querySelector<HTMLElement>('[data-slot=name-stem]')?.textContent,
    extension: () => chip.querySelector<HTMLElement>('[data-slot=name-extension]')?.textContent,
    error: () => chip.querySelector<HTMLElement>('[data-slot=error]'),
    retry: () => chip.querySelector<HTMLButtonElement>('[data-slot=retry]'),
    size: () => chip.querySelector<HTMLElement>('[data-slot=size]'),
    icon: () => chip.querySelector('[data-slot=icon] path')?.getAttribute('d'),
    remove: () => chip.querySelector<HTMLButtonElement>('[data-slot=remove]'),
    download: () => chip.querySelector<HTMLButtonElement>('[data-slot=download-button]'),
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

  it('cuts a long name in its stem, never its extension', async () => {
    expect(part.stem()).toBe('Q4-report');
    expect(part.extension()).toBe('.pdf');

    host.attachment.set({ name: 'README' });
    await fixture.whenStable();
    expect(part.stem()).toBe('README');
    expect(part.extension()).toBeUndefined();
    expect(part.name().textContent).toBe('README');
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

  it('has no download button unless the host can hand the file back', () => {
    expect(part.download()).toBeNull();
  });

  it('asks for a download from the icon’s square, labelled with the file', async () => {
    host.downloadable.set(true);
    await fixture.whenStable();

    const leading = chip.querySelector('[data-slot=leading]')!;
    expect(leading.querySelector('[data-slot=icon-button]')?.contains(part.download())).toBe(true);
    expect(leading.querySelector('[data-slot=icon]')).toBeTruthy();
    expect(part.download()?.getAttribute('aria-label')).toBe('Download Q4-report.pdf');

    part.download()!.click();
    await fixture.whenStable();
    expect(host.downloads).toBe(1);
  });

  it('offers no download while the transfer is in flight', async () => {
    host.downloadable.set(true);
    host.status.set('uploading');
    host.progress.set(0.4);
    await fixture.whenStable();
    expect(part.download()).toBeNull();

    host.status.set('complete');
    await fixture.whenStable();
    expect(part.download()).toBeTruthy();
  });

  it('when failed, says so in the size’s place and offers a retry in the icon’s square', async () => {
    host.downloadable.set(true);
    host.status.set('failed');
    await fixture.whenStable();

    expect(chip.dataset['status']).toBe('failed');
    expect(chip.hasAttribute('aria-busy')).toBe(false);
    expect(part.size()).toBeNull();
    expect(part.error()?.textContent?.trim()).toBe('Upload failed');
    expect(part.progress()).toBeNull();
    // The retry has the square — no file to hand back yet.
    expect(part.download()).toBeNull();
    const square = chip.querySelector('[data-slot=leading] [data-slot=icon-button]')!;
    expect(square.contains(part.retry())).toBe(true);
    expect(part.retry()?.getAttribute('aria-label')).toBe('Retry Q4-report.pdf');
    // The × stays.
    expect(part.remove()).toBeTruthy();

    part.retry()!.click();
    await fixture.whenStable();
    expect(host.retries).toBe(1);

    host.status.set('queued');
    await fixture.whenStable();
    expect(part.retry()).toBeNull();
    expect(part.error()).toBeNull();
  });

  it('takes the retry out of play when aria-disabled', async () => {
    host.status.set('failed');
    host.disabled.set(true);
    await fixture.whenStable();

    expect(part.retry()?.disabled).toBe(true);
  });

  it('takes the host’s word on whether it is an image over its MIME type', async () => {
    host.attachment.set({ name: 'IMG_0042.heic', type: '' });
    await fixture.whenStable();
    expect(chip.dataset['kind']).toBe('file');

    host.isImage.set(true);
    await fixture.whenStable();
    expect(chip.dataset['kind']).toBe('image');

    // A type that only claimed to be an image.
    host.attachment.set({ name: 'not-really.png', type: 'image/png' });
    host.isImage.set(false);
    await fixture.whenStable();
    expect(chip.dataset['kind']).toBe('file');
  });

  it('shows an image’s preview behind it, decorative, and nothing for any other file', async () => {
    const preview = () => chip.querySelector<HTMLImageElement>('[data-slot=preview]');
    host.preview.set('blob:preview');
    await fixture.whenStable();
    // A PDF is no picture, whatever URL it is handed.
    expect(preview()).toBeNull();
    expect(chip.hasAttribute('data-preview')).toBe(false);

    host.attachment.set({ name: 'photo.jpg', type: 'image/jpeg' });
    await fixture.whenStable();
    expect(preview()?.getAttribute('src')).toBe('blob:preview');
    expect(preview()?.getAttribute('alt')).toBe('');
    expect(chip.hasAttribute('data-preview')).toBe(true);
  });

  it('drops a preview that does not load, and tries again with a new URL', async () => {
    const preview = () => chip.querySelector<HTMLImageElement>('[data-slot=preview]');
    host.attachment.set({ name: 'photo.jpg', type: 'image/jpeg' });
    host.preview.set('blob:gone');
    await fixture.whenStable();

    preview()!.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(preview()).toBeNull();
    expect(chip.hasAttribute('data-preview')).toBe(false);

    host.preview.set('blob:fresh');
    await fixture.whenStable();
    expect(preview()?.getAttribute('src')).toBe('blob:fresh');
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

  it('takes the download button out of play too when aria-disabled', async () => {
    host.downloadable.set(true);
    host.disabled.set(true);
    await fixture.whenStable();

    expect(part.download()?.disabled).toBe(true);
  });

  it('is not clickable itself unless activatable', () => {
    expect(chip.querySelector('[data-slot=action]')).toBeNull();
    expect(chip.hasAttribute('data-activatable')).toBe(false);
  });

  it('when activatable, is one button over the chip, named for the file, apart from its own buttons', async () => {
    host.activatable.set(true);
    await fixture.whenStable();

    const action = chip.querySelector<HTMLButtonElement>('[data-slot=action]')!;
    expect(chip.hasAttribute('data-activatable')).toBe(true);
    expect(action.tagName).toBe('BUTTON');
    expect(action.getAttribute('aria-label')).toBe('Q4-report.pdf');
    // A sibling of the other buttons, never their parent.
    expect(action.querySelector('button')).toBeNull();

    action.click();
    part.remove()!.click();
    await fixture.whenStable();
    expect(host.activations).toBe(1);
    expect(host.removals).toBe(1);

    host.disabled.set(true);
    await fixture.whenStable();
    expect(action.disabled).toBe(true);
  });

  it('marks every part with a data-slot', () => {
    const names = [...chip.querySelectorAll('[data-slot]')].map((el) =>
      el.getAttribute('data-slot'),
    );
    expect(names).toEqual([
      'leading',
      'icon',
      'label',
      'name',
      'name-stem',
      'name-extension',
      'size',
      'trailing',
      'tail-button',
      'remove',
    ]);
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

  it('places the host’s icon button over the icon, in place of its own, once settled', async () => {
    @Component({
      imports: [AttachmentChip, AttachmentChipIconButton],
      template: `<li email-attachment-chip [attachment]="attachment" [status]="status()" aria-disabled>
        <button
          *emailAttachmentIconButton="let file; let disabled = disabled"
          [disabled]="disabled"
          (click)="fetched = file.name"
        >get</button>
      </li>`,
    })
    class DownloadHost {
      readonly attachment: Attachment = { name: 'x.pdf', type: 'application/pdf' };
      readonly status = signal<AttachmentStatus>('uploading');
      fetched = '';
    }
    await TestBed.configureTestingModule({ imports: [DownloadHost] }).compileComponents();
    const fixture = TestBed.createComponent(DownloadHost);
    await fixture.whenStable();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('[email-attachment-chip]')!;

    // Nothing to fetch while the upload runs.
    expect(chip.querySelector('[data-slot=icon-button]')).toBeNull();

    fixture.componentInstance.status.set('complete');
    await fixture.whenStable();

    // The box is the chip's, in the leading square; the button is the host's,
    // the chip's own is not there, and the host's click is the download.
    const button = chip.querySelector<HTMLButtonElement>('[data-slot=leading] [data-slot=icon-button] > button')!;
    expect(button.textContent).toBe('get');
    expect(chip.querySelector('[data-slot=download-button]')).toBeNull();
    expect(button.disabled).toBe(true);
    button.disabled = false;
    button.click();
    expect(fixture.componentInstance.fetched).toBe('x.pdf');
  });

  it('puts the host’s tail button in place of the ×, told whether work is in flight', async () => {
    @Component({
      imports: [AttachmentChip, AttachmentChipTailButton],
      template: `<li email-attachment-chip [attachment]="attachment" [status]="status()">
        <button *emailAttachmentTailButton="let file; let busy = busy" (click)="pressed = busy">
          {{ busy ? 'cancel' : 'drop' }}
        </button>
      </li>`,
    })
    class TailHost {
      readonly attachment: Attachment = { name: 'x.pdf', type: 'application/pdf' };
      readonly status = signal<AttachmentStatus>('uploading');
      pressed: boolean | null = null;
    }
    await TestBed.configureTestingModule({ imports: [TailHost] }).compileComponents();
    const fixture = TestBed.createComponent(TailHost);
    await fixture.whenStable();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('[email-attachment-chip]')!;
    const button = () =>
      chip.querySelector<HTMLButtonElement>('[data-slot=trailing] [data-slot=tail-button] > button')!;

    expect(chip.querySelector('[data-slot=remove]')).toBeNull();
    expect(button().textContent?.trim()).toBe('cancel');
    button().click();
    expect(fixture.componentInstance.pressed).toBe(true);

    fixture.componentInstance.status.set('complete');
    await fixture.whenStable();
    expect(button().textContent?.trim()).toBe('drop');
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
