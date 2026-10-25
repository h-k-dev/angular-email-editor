import { Component, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import {
  Attachment,
  AttachmentChip,
  AttachmentChipIcon,
  AttachmentKind,
  AttachmentStatus,
} from '@h-k-dev/angular-email-editor/attachment-chip';

import { Playground, PlaygroundAction, PlaygroundSubject, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** The files a knob picks between: one per thing the chip draws differently. */
const FILES = {
  pdf: { name: 'Quarterly report.pdf', type: 'application/pdf', size: 2_400_000 },
  image: { name: 'Team photo.jpg', type: 'image/jpeg', size: 640_000 },
  archive: { name: 'assets.zip', type: 'application/zip', size: 18_500_000 },
  long: {
    name: 'A file name far too long to fit on one chip without cutting it down.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 48_000,
  },
  unknown: { name: 'notes' },
} satisfies Record<string, Attachment>;

type FileKey = keyof typeof FILES;

/** No status at all — the chip as a host without stages has it. */
type StatusKnob = AttachmentStatus | 'none';

/** A thumbnail with no file behind it: a gradient, drawn here. */
const PREVIEW =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x2="1" y2="1">' +
      '<stop stop-color="#8C1D40"/><stop offset="1" stop-color="#F2B8B5"/></linearGradient></defs>' +
      '<rect width="40" height="40" fill="url(#g)"/></svg>',
  );

/** The demo's Material glyph for each kind, for the icon slot. */
const KIND_ICONS: Record<AttachmentKind, string> = {
  image: 'image',
  video: 'movie',
  audio: 'audio_file',
  pdf: 'picture_as_pdf',
  archive: 'folder_zip',
  spreadsheet: 'table_chart',
  presentation: 'slideshow',
  document: 'description',
  message: 'mail',
  file: 'draft',
};

/**
 * One attachment chip, every stage of a transfer at a knob's reach: the
 * status and the number, the buttons it offers, the chip's own simulated
 * progress (re-run by re-creating the chip), a preview, and the icon slot
 * filled with Material glyphs as the demo composer does.
 */
@Component({
  selector: 'attachment-chip-playground',
  imports: [PlaygroundFrame, PlaygroundSubject, AttachmentChip, AttachmentChipIcon, MatIcon],
  templateUrl: './attachment-chip-playground.html',
  styleUrl: '../playground/playground-stage.scss',
  providers: [Playground],
})
export class AttachmentChipPlayground {
  protected readonly playground = inject(Playground);

  readonly file = signal<FileKey>('pdf');
  readonly status = signal<StatusKnob>('uploading');
  /** Percent; -1 is `null` — no number. */
  readonly progress = signal(42);
  readonly removable = signal(true);
  readonly downloadable = signal(false);
  readonly activatable = signal(false);
  readonly ariaBusy = signal(false);
  readonly ariaDisabled = signal(false);
  readonly simulateProgress = signal(false);
  readonly preview = signal(false);
  readonly iconSlot = signal(false);

  protected readonly attachment = computed<Attachment>(() => FILES[this.file()]);
  protected readonly chipStatus = computed(() =>
    this.status() === 'none' ? null : (this.status() as AttachmentStatus),
  );
  protected readonly chipProgress = computed(() =>
    this.progress() < 0 ? null : this.progress() / 100,
  );
  protected readonly previewUrl = computed(() => (this.preview() ? PREVIEW : null));

  /** Bumped to make the chip anew — `simulateProgress` runs once, at init. */
  protected readonly run = signal(0);
  protected readonly runs = computed(() => [this.run()]);

  protected readonly icons = KIND_ICONS;

  protected readonly knobs = [
    knob.choice('attachment', this.file, Object.keys(FILES) as FileKey[]),
    knob.choice('status', this.status, [
      'none',
      'preprocessing',
      'queued',
      'uploading',
      'postprocessing',
      'complete',
      'failed',
    ]),
    knob.number('progress % (−1 = null)', this.progress, { min: -1, max: 100, step: 5 }),
    knob.boolean('removable', this.removable),
    knob.boolean('downloadable', this.downloadable),
    knob.boolean('activatable', this.activatable),
    knob.boolean('aria-busy', this.ariaBusy),
    knob.boolean('aria-disabled', this.ariaDisabled),
    knob.boolean('simulateProgress', this.simulateProgress),
    knob.boolean('preview', this.preview),
    knob.boolean('emailAttachmentIcon slot', this.iconSlot),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: 're-create chip', run: () => this.run.update((run) => run + 1) },
  ];
}
