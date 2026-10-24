import { Component, model, output, signal } from '@angular/core';

// ngx-translate
import { TranslatePipe } from '@ngx-translate/core';

// Material
import { MatIconModule } from '@angular/material/icon';
import { KeepFocus } from '@h-k-dev/angular-email-editor/focus';
import { TableKind } from '@h-k-dev/angular-email-editor';

/**
 * The table picker: which kind of table (`TableKind` — bordered, the default;
 * borderless; layout), then an 8×8 grid — sweep it to preview columns × rows,
 * click to insert. Every cell is a real button, so the keyboard path
 * (Tab/arrows + Enter) works and focus drives the same preview as hover.
 * Rendered fresh on every open, so the preview never starts from a stale
 * sweep; it starts at the command's default size. The kind is the host's
 * (`kind`, two-way), so it is still the one last used on the next open.
 */
@Component({
  selector: 'div[table-picker]',
  imports: [TranslatePipe, MatIconModule],
  templateUrl: './table-picker.html',
  styleUrl: './table-picker.scss',
  hostDirectives: [KeepFocus],
})
export class TablePicker {
  /** Which table the grid inserts. */
  readonly kind = model<TableKind>('bordered');

  /** A size was picked, columns × rows — the way the grid is swept. */
  readonly picked = output<{ cols: number; rows: number }>();

  protected readonly kinds: { kind: TableKind; icon: string }[] = [
    { kind: 'bordered', icon: 'grid_on' },
    { kind: 'borderless', icon: 'border_clear' },
    { kind: 'layout', icon: 'view_quilt' },
  ];

  protected readonly steps = Array.from({ length: 8 }, (_, i) => i);
  protected readonly pick = signal({ cols: 2, rows: 2 });
}
