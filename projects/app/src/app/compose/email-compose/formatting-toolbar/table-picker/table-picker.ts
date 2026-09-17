import { Component, output, signal } from '@angular/core';

// Material
import { MatIconModule } from '@angular/material/icon';
import { KeepFocus } from 'angular-email-editor/focus';

/**
 * The table-size picker: an 8×8 grid — sweep it to preview columns × rows,
 * click to insert. Every cell is a real button, so the keyboard path
 * (Tab/arrows + Enter) works and focus drives the same preview as hover.
 * Rendered fresh on every open, so the preview never starts from a stale
 * sweep; it starts at the command's default size.
 */
@Component({
  selector: 'div[table-picker]',
  imports: [MatIconModule],
  templateUrl: './table-picker.html',
  styleUrl: './table-picker.scss',
  hostDirectives: [KeepFocus],
})
export class TablePicker {
  /** A size was picked, columns × rows — the way the grid is swept. */
  readonly picked = output<{ cols: number; rows: number }>();

  protected readonly steps = Array.from({ length: 8 }, (_, i) => i);
  protected readonly pick = signal({ cols: 2, rows: 2 });
}
