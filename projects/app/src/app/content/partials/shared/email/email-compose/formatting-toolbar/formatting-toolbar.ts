import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
  TemplateRef,
} from '@angular/core';

// ngx-translate
import { TranslatePipe } from '@ngx-translate/core';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';

// Aria
import { MenuTrigger } from '@angular/aria/menu';

// CDK
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

import { Viewport } from '../../../../../../core/layout/viewport';
import { FormattingCommands } from '../formatting-commands';
import {
  FormattingItem,
  FormattingItemId,
  FormattingLayout,
  FormattingPicker,
  layoutEntries,
} from '../formatting-items';
import { ColorPicker } from './color-picker/color-picker';
import { createFontState } from './font-state';
import { TablePicker } from './table-picker/table-picker';
import { ToolbarKeys } from './toolbar-keys';
import { ToolbarMenu, ToolbarMenuItem, ToolbarMenuRow } from './toolbar-menu/toolbar-menu';
import { PaperIslandScheme } from '../../paper-island';
import { ToolbarOverflow, ToolbarOverflowItem } from './toolbar-overflow';
import { KeepFocus } from '@h-k-dev/angular-email-editor/focus';
import { TableKind } from '@h-k-dev/angular-email-editor';

/** The buttons in the order people reach for them — marks, colour, then link,
    lists and their indent, the paragraph's shape, the rarer marks, the table — and so the
    order they move into the ⋯ menu, from the end, when the line runs out. */
const LAYOUT: FormattingLayout = [
  ['bold', 'italic', 'underline', 'color'],
  ['link', 'bulleted-list', 'numbered-list', 'outdent', 'indent'],
  ['quote', 'align-left', 'align-center', 'align-right'],
  ['strike', 'uppercase', 'clear-formatting'],
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
    NgTemplateOutlet,

    // ngx-translate
    TranslatePipe,

    // Material
    MatButtonModule,
    MatDividerModule,
    MatIconModule,

    // Aria
    MenuTrigger,

    // CDK
    OverlayModule,

    ColorPicker,
    TablePicker,
    ToolbarMenu,
    ToolbarMenuRow,
    PaperIslandScheme,
    ToolbarOverflow,
    ToolbarOverflowItem,
  ],
  // Every tool keeps focus where it is, so the editor keeps its caret.
  hostDirectives: [ToolbarKeys, KeepFocus],
  templateUrl: './formatting-toolbar.html',
  styleUrl: './formatting-toolbar.scss',
  host: {
    class: 'formatting-toolbar',
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

  /** What stands at the line's end, after history — a template the host
      hands in: the chat-based suggestion's button while its strip is up,
      so that the button is part of the bar rather than a row of its own. */
  readonly end = input<TemplateRef<unknown> | null>(null);

  /** Wide: one dense line with a ⋯; otherwise a phone's scrolling row. */
  protected readonly wide = computed(() => !this.#viewport.compact());

  protected readonly entries = computed(() =>
    layoutEntries(this.commands.items, LAYOUT, this.commands.offered()),
  );

  protected readonly font = createFontState(
    this.commands,
    computed(() => this.wide() && this.shown()),
  );

  /** The size menu's custom field, as typed: it starts from the custom size
      on the text (none for a size of the menu's), and starts over whenever
      the text under the caret changes it. */
  protected readonly customSize = linkedSignal(() => this.font.customSize()?.toString() ?? '');

  /** What the field says, as a size — px, 0 or more — or null while it says
      nothing a size can be (empty, negative, not a number). */
  protected readonly customSizeValue = computed(() => {
    const text = this.customSize().trim();
    const size = Number(text);
    return text !== '' && Number.isFinite(size) && size >= 0 ? size : null;
  });

  /** The custom size applied to the text — the field's button, or Enter in
      it — and the menu closed. */
  protected applyCustomSize(trigger: MenuTrigger<unknown>): void {
    const size = this.customSizeValue();
    if (size === null) return;
    trigger.close();
    this.commands.applyFontSize(size);
  }

  /** The field's keys are its own — the menu would read a digit as a jump
      to an item — except Escape (the menu's to close) and Tab; Enter
      applies. */
  protected customSizeKey(event: KeyboardEvent, trigger: MenuTrigger<unknown>): void {
    if (event.key === 'Escape' || event.key === 'Tab') return;
    event.stopPropagation();
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.applyCustomSize(trigger);
  }

  /** The picker that is open, if any, and where it is anchored: its button,
      or the ⋯ when the button has moved there. */
  protected readonly picker = signal<FormattingPicker | null>(null);
  protected readonly pickerOrigin = signal<Element>(inject(ElementRef).nativeElement);
  /** Centred on its button: below it, or above when there is no room —
      pushed back on screen near an edge. */
  protected readonly pickerPositions: ConnectedPosition[] = [
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top' },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom' },
  ];

  protected readonly overflow = viewChild(ToolbarOverflow);

  /** The ⋯ menu's items: the buttons that moved, in toolbar order, grouped
      as on the toolbar. */
  protected readonly moreItems = computed<ToolbarMenuItem<FormattingItemId>[]>(() => {
    const from = this.overflow()?.overflowFrom() ?? null;
    if (from === null) return [];
    return this.entries().slice(from).map(({ item, separated }, i) => ({
      value: item.id,
      label: item.title(),
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
    const entry = this.entries().find(({ item }) => item.id === id);
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

  /** The table kind the picker inserts — kept here, so the picker opens on
      the one last used. */
  protected readonly tableKind = signal<TableKind>('bordered');

  protected insertTable(size: { cols: number; rows: number }): void {
    this.picker.set(null);
    this.commands.insertTable({ ...size, kind: this.tableKind() });
  }
}
