import { Component, computed, inject, signal } from '@angular/core';
import { AttachmentChip } from '@h-k-dev/angular-email-editor/attachment-chip';
import { AttachmentChips } from '@h-k-dev/angular-email-editor/attachment-chips';

import { Playground, PlaygroundAction, PlaygroundSubject, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** A message's attachment, as this host keeps it: its own key to track by. */
interface Upload {
  readonly key: number;
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

/** What "add" picks from, in turn. */
const SAMPLES: readonly Omit<Upload, 'key'>[] = [
  { name: 'Quarterly report.pdf', type: 'application/pdf', size: 2_400_000 },
  { name: 'Team photo.jpg', type: 'image/jpeg', size: 640_000 },
  { name: 'Budget.xlsx', type: 'application/vnd.ms-excel', size: 120_000 },
  { name: 'assets.zip', type: 'application/zip', size: 18_500_000 },
  { name: 'Minutes.docx', type: 'application/msword', size: 48_000 },
];

let key = 0;
const sample = (): Upload => ({ key: ++key, ...SAMPLES[key % SAMPLES.length] });

/**
 * The strip as a form control: the host renders a chip per item of the
 * value, and a chip's × takes its item out of the value with no wiring —
 * the value panel shows it go, focus moving to the neighbour. The knobs
 * are the strip's; `simulateProgress` is every chip's, so the strip's own
 * `aria-busy` can be watched.
 */
@Component({
  selector: 'attachment-chips-playground',
  imports: [PlaygroundFrame, PlaygroundSubject, AttachmentChips, AttachmentChip],
  templateUrl: './attachment-chips-playground.html',
  styleUrl: '../playground/playground-stage.scss',
  providers: [Playground],
})
export class AttachmentChipsPlayground {
  protected readonly playground = inject(Playground);

  readonly files = signal<Upload[]>([sample(), sample(), sample()]);
  readonly label = signal('Attachments');
  readonly disabled = signal(false);
  readonly simulateProgress = signal(false);

  /** The value, short: the names in order. */
  protected readonly names = computed(() => this.files().map((file) => file.name));

  protected readonly knobs = [
    knob.text('label', this.label),
    knob.boolean('disabled', this.disabled),
    knob.boolean('simulateProgress (chips)', this.simulateProgress),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: 'add a file', run: () => this.files.update((files) => [...files, sample()]) },
    {
      name: 'add five',
      run: () => this.files.update((files) => [...files, ...Array.from({ length: 5 }, sample)]),
    },
    { name: 'empty the value', run: () => this.files.set([]) },
  ];

  protected changed(files: Upload[]): void {
    this.files.set(files);
    this.playground.log(
      'valueChange',
      files.map((file) => file.name),
    );
  }
}
