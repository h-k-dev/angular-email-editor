import {
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';

// Aria
import { MenuTrigger } from '@angular/aria/menu';

// CDK
import { OverlayModule } from '@angular/cdk/overlay';

// Library
import { emailBackgroundPalette, emailTextPalette } from 'angular-email-editor';

import { Viewport } from '../../../../services/viewport';
import { FormattingCommands } from '../formatting-commands';
import {
  FormattingItem,
  FormattingItemId,
  FormattingLayout,
  FormattingPicker,
  layoutEntries,
} from '../formatting-items';
import { ColorPalette } from './color-palette/color-palette';
import { createFontState } from './font-state';
import { TablePicker } from './table-picker/table-picker';
import { ToolbarKeys } from './toolbar-keys';
import { ToolbarMenu, ToolbarMenuItem } from './toolbar-menu/toolbar-menu';
import { ToolbarOverflow, ToolbarOverflowItem } from './toolbar-overflow';
import { KeepFocus } from 'angular-email-editor/focus';

/** The buttons in the order people reach for them — marks, colour, then link,
    lists and their indent, the paragraph's shape, the rarer marks, the table — and so the
    order they move into the ⋯ menu, from the end, when the line runs out. */
const LAYOUT: FormattingLayout = [
  ['bold', 'italic', 'underline'],
  ['text-color', 'highlight'],
  ['link', 'bulleted-list', 'numbered-list', 'outdent', 'indent'],
  ['quote', 'align-left', 'align-center', 'align-right'],
  ['strike', 'clear-formatting'],
  ['table'],
];

/**
 * The composer's formatting toolbar, below the editing surface: on a phone
 * the shell's height follows the virtual keyboard (see app.scss), so the bar
 * rides up and stays reachable right above the keys.
 *
 * One line at every width. Wide: font and size dropdowns, then the buttons
 * of `LAYOUT`; when the line runs out the tail moves into the ⋯ menu
 * (`ToolbarOverflow`). On a phone the row scrolls instead and keeps only
 * what the text cannot do by itself (`FormattingItem.wide`). History is
 * pinned to the line's end either way.
 *
 * Formatting only: how the HTML source shows, and the preview, are the
 * writer bar's (compose.html). Acts through the composer's
 * `FormattingCommands`, on the items it defines. Arrow keys walk the tools
 * (`ToolbarKeys`).
 */
@Component({
  selector: 'div[formatting-toolbar]',
  imports: [
    // Material
    MatButtonModule,
    MatDividerModule,
    MatIconModule,

    // Aria
    MenuTrigger,

    // CDK
    OverlayModule,

    ColorPalette,
    TablePicker,
    ToolbarMenu,
    ToolbarOverflow,
    ToolbarOverflowItem,
  ],
  // Every tool keeps focus where it is, so the editor keeps its caret.
  hostDirectives: [ToolbarKeys, KeepFocus],
  templateUrl: './formatting-toolbar.html',
  styleUrl: './formatting-toolbar.scss',
  host: {
    class: 'toolbar',
    role: 'toolbar',
    '[hidden]': '!shown()',
  },
})
export class FormattingToolbar {
  protected readonly commands = inject(FormattingCommands);
  readonly #viewport = inject(Viewport);

  /** Whether the toolbar shows — the host's switch (the writer bar's
      formatting options). Hidden, the text keeps its keyboard shortcuts,
      the slash menu and the bubble menu. */
  readonly shown = input(true, { transform: booleanAttribute });

  /** Wide: one dense line with a ⋯; otherwise a phone's scrolling row. */
  protected readonly wide = computed(() => !this.#viewport.compact());

  protected readonly entries = layoutEntries(this.commands.items, LAYOUT);

  protected readonly font = createFontState(
    this.commands,
    computed(() => this.wide() && this.shown()),
  );

  protected readonly textPalette = emailTextPalette;
  protected readonly backgroundPalette = emailBackgroundPalette;

  /** The picker that is open, if any, and where it is anchored: its button,
      or the ⋯ when the button has moved there. */
  protected readonly picker = signal<FormattingPicker | null>(null);
  protected readonly pickerOrigin = signal<Element>(inject(ElementRef).nativeElement);

  protected readonly overflow = viewChild(ToolbarOverflow);

  /** The ⋯ menu's items: the buttons that moved, in toolbar order, grouped
      as on the toolbar. */
  protected readonly moreItems = computed<ToolbarMenuItem<FormattingItemId>[]>(() => {
    const from = this.overflow()?.overflowFrom() ?? null;
    if (from === null) return [];
    return this.entries.slice(from).map(({ item, separated }, i) => ({
      value: item.id,
      label: this.commands.label(item),
      icon: item.icon,
      kind: item.pressed ? 'checkbox' : undefined,
      checked: item.pressed?.(),
      disabled: item.disabled?.(),
      separated: i > 0 && separated,
    }));
  });

  /** Presses a button — on the toolbar, or chosen from the ⋯ menu. A picker
      opens at `origin`. */
  protected press(item: FormattingItem, origin: Element): void {
    if (!item.picker) {
      item.run?.();
      return;
    }
    const picker = item.picker;
    this.pickerOrigin.set(origin);
    this.picker.update((open) => (open === picker ? null : picker));
  }

  protected pressById(id: FormattingItemId, origin: Element): void {
    const entry = this.entries.find(({ item }) => item.id === id);
    if (entry) this.press(entry.item, origin);
  }

  protected applyColor(color: string | null): void {
    this.picker.set(null);
    this.commands.applyColor(color);
  }

  protected applyBackground(color: string | null): void {
    this.picker.set(null);
    this.commands.applyBackground(color);
  }

  protected insertTable(size: { cols: number; rows: number }): void {
    this.picker.set(null);
    this.commands.insertTable(size);
  }
}
