import { Component, inject, signal } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('app');

  constructor() {
    // Self-hosted Material Symbols (public/sass/font): mat-icon defaults to
    // the classic 'material-icons' ligature class; point every icon at the
    // new font's class instead.
    inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
  }
}
