import {
  Component,
  ElementRef,
  TemplateRef,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

// ProseMirror
import { TextSelection } from 'prosemirror-state';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';

// CDK
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

// Library
import { BubbleMenuState, selectedImageAlt } from '@h-k-dev/angular-email-editor';
import { ActionTrigger } from '@h-k-dev/angular-email-editor/actions';
import { KeepFocus } from '@h-k-dev/angular-email-editor/focus';
import { TranslatePipe } from '@ngx-translate/core';

import { I18n } from '../../../../../../core/translations/i18n';
import { FormattingCommands } from '../formatting-commands';
import { FormattingLayout, layoutEntries } from '../formatting-items';
import { ColorPicker } from '../formatting-toolbar/color-picker/color-picker';
import { ToolbarKeys } from '../formatting-toolbar/toolbar-keys';
import { PaperIslandScheme } from '../../paper-island';
import { POPOVER_ABOVE, Popover } from '../popover/popover';

/** The bubble menu's groups: the marks and their colour, then what wraps
    the selection — a link, a button link, a quote. */
const LAYOUT: FormattingLayout = [
  ['bold', 'italic', 'underline', 'strike', 'color'],
  ['link', 'button-link', 'quote'],
];

/** A selected button: its label's weight and slant (the kit's own toggles,
    which act on the button as a whole), its link (the link editor, on the
    button — which also edits its words), turning it back into text (the
    same toggle, shown on), and where it sits on its line — a call to
    action is usually centred. */
const BUTTON_LAYOUT: FormattingLayout = [
  ['bold', 'italic'],
  ['link', 'button-link'],
  ['align-left', 'align-center', 'align-right'],
];

/** An image alone gets its own tools instead: where it sits on its line
    (the line's alignment — the image is inline), then swapping the file
    and taking it out. The alt text leads, as a text button (see the
    template). */
const IMAGE_LAYOUT: FormattingLayout = [
  ['align-left', 'align-center', 'align-right'],
  ['replace-image', 'remove-image'],
];

/** The colour pane, centred on its button: away from the selection first
    (see `toggleColor`), the other side when there is no room. */
const COLOR_ABOVE: ConnectedPosition[] = [
  { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -4 },
  { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 4 },
];
const COLOR_BELOW: ConnectedPosition[] = [COLOR_ABOVE[1], COLOR_ABOVE[0]];

/**
 * The bubble menu: the marks you reach for on a selection, floating above
 * it. Opened, closed and placed by the editor's bubble-menu extension —
 * the composer feeds its state in — and acting through the composer's
 * `FormattingCommands`, on the same items as the toolbar.
 *
 * A panel of the composer's one popover (`Popover`): up while the
 * extension says so, over the selection's box. One toolbar, with a set of
 * tools per thing selected — an image alone and a button get their own
 * (the extension says which, `kind`), anything else the marks — swapped
 * *inside* the popover as the selection changes: passing an image by one
 * character turns the image's tools into the text's, in the box that is
 * already there, rather than landing a second menu over the first.
 *
 * A mousedown never takes focus, so the editor's selection survives the
 * click — which is also what keeps the menu open through it.
 */
@Component({
  selector: 'div[bubble-menu]',
  imports: [
    TranslatePipe,
    NgTemplateOutlet,

    // Material
    MatButtonModule,
    MatDividerModule,
    MatIconModule,

    // CDK
    OverlayModule,

    // Library
    ActionTrigger,
    KeepFocus,

    ColorPicker,
    PaperIslandScheme,
    ToolbarKeys,
  ],
  templateUrl: './bubble-menu.html',
  styleUrl: './bubble-menu.scss',
})
export class BubbleMenu {
  /** The extension's state: whether the menu shows, and the selection's box
      in viewport coordinates, which the popover's anchor takes. */
  readonly state = input.required<BubbleMenuState>();

  readonly #commands = inject(FormattingCommands);

  protected readonly entries = layoutEntries(this.#commands.items, LAYOUT);

  protected readonly imageEntries = layoutEntries(this.#commands.items, IMAGE_LAYOUT);

  protected readonly buttonEntries = layoutEntries(this.#commands.items, BUTTON_LAYOUT);

  protected readonly altItem = this.#commands.items['image-alt'];

  /** The selected image's alt, shown on its button — so a missing one is
      seen, not just editable. */
  protected readonly alt = computed(() => {
    const state = this.#commands.state();
    return state ? selectedImageAlt(state) : null;
  });

  /** The alt button's name when it shows an alt: what the button is, then
      what it says — one translatable phrase, so each language places the
      two (and its own colon). Without an alt, the visible "Add alt text"
      is the name. */
  protected readonly altLabel = computed(() => {
    const alt = this.alt();
    return alt ? this.i18n.t('editor.image.altWithValue', { alt }) : null;
  });

  protected readonly i18n = inject(I18n);

  /** The visible editor's actions, which the buttons trigger by id. */
  protected readonly actions = this.#commands.actions;

  /** Whether the colour pane is open — shut again whenever the menu
      closes or turns into another kind's tools, which have no colour
      button to stand at. */
  protected readonly colorOpen = linkedSignal({
    source: () => (this.state().isOpen ? (this.state().kind ?? 'text') : null),
    computation: () => false,
  });
  protected readonly colorOrigin = signal<Element>(inject(ElementRef).nativeElement);
  protected readonly colorPositions = signal<ConnectedPosition[]>(POPOVER_ABOVE);

  protected readonly textColor = this.#commands.textColor;
  protected readonly backgroundColor = this.#commands.backgroundColor;

  /** Opens the colour pane at its button, or closes it. It opens on the
      menu's far side from the selection: above a menu that stands above
      the text, below one that had to go under it. */
  protected toggleColor(button: Element): void {
    if (this.colorOpen()) {
      this.colorOpen.set(false);
      return;
    }
    const selection = this.state().boundingBox;
    const above = !selection || button.getBoundingClientRect().top < selection.top;
    this.colorOrigin.set(button);
    this.colorPositions.set(above ? COLOR_ABOVE : COLOR_BELOW);
    this.colorOpen.set(true);
  }

  /** A press outside the pane closes it — but not the colour button's own,
      which toggles it by itself. */
  protected onColorOutsideClick(event: MouseEvent): void {
    if (this.colorOrigin().contains(event.target as Node)) return;
    this.colorOpen.set(false);
  }

  protected applyColor(color: string | null): void {
    this.colorOpen.set(false);
    this.#commands.applyColor(color);
  }

  protected applyBackground(color: string | null): void {
    this.colorOpen.set(false);
    this.#commands.applyBackground(color);
  }

  /** The toolbar's name, by what it is for. */
  protected readonly menuLabel = computed(() => {
    switch (this.state().kind) {
      case 'image':
        return this.i18n.t('editor.image.menu');
      case 'button':
        return this.i18n.t('editor.button.menu');
      default:
        return this.i18n.t('editor.menu.selection');
    }
  });

  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly panel = viewChild<TemplateRef<unknown>>('panel');

  constructor() {
    inject(Popover).register({
      layer: 'toolbar',
      open: () => this.state().isOpen,
      anchor: () => this.state().boundingBox,
      content: this.panel,
      positions: () => POPOVER_ABOVE,
      // Asked to close: the selection collapses to its end — the menu is
      // the selection's, and goes with it.
      close: () => {
        const editor = this.#commands.editor();
        if (!editor) return;
        const { state } = editor;
        editor.view.dispatch(
          state.tr.setSelection(TextSelection.create(state.doc, state.selection.to)),
        );
      },
    });
  }
}
