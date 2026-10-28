import {
  Component,
  ElementRef,
  Injector,
  TemplateRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

// Angular Signal Forms
import { FormField, debounce, disabled, form, max, min } from '@angular/forms/signals';

// Material
import { MatIconModule } from '@angular/material/icon';

// Angular Aria
import { Menu, MenuItem } from '@angular/aria/menu';

// CDK
import { ConnectedPosition } from '@angular/cdk/overlay';

// Library
import {
  SECTION_PADDING_MAX,
  SECTION_PADDING_STEP,
  SECTION_WIDTH_MAX,
  SECTION_WIDTH_MIN,
  SECTION_WIDTH_STEP,
  SectionHandleTarget,
  findBandContext,
  findSectionContext,
  authoredPageBands,
  convertAuthoredPage,
  convertAuthoredPageToRows,
  selectedSpacer,
  spacerOfBand,
} from '@h-k-dev/angular-email-editor';
import {
  editorState,
  sectionBackgroundModel,
  sectionPaddingModel,
  sectionWidthModel,
} from '@h-k-dev/angular-email-editor/actions';
import { FieldKeys } from '@h-k-dev/angular-email-editor/keyboard';
import { injectPalette } from '@h-k-dev/angular-email-editor/palette';

import { FormattingCommands } from '../formatting-commands';
import { Popover } from '../popover/popover';
import { MenuSafeTriangle } from '../../../../../../core/utils/cascade-menu/safe-triangle';
import { SubmenuPlacement } from '../../../../../../core/utils/cascade-menu/submenu-placement';
import { FloatingScrollbar } from '../../../../common/floating-scrollbar/floating-scrollbar';

/** What a row of the menu does, as the item's value: `fill:<hex>` or
    `fill:` (none), `image`, `remove`. */
type SectionAction = string;

/**
 * The band's menu, the cell's sibling: the grip centred on the caret band's
 * top edge opens it — Color (its fill), Background image (the picture behind
 * it, by address) and Remove (the band goes, its content stays). A panel of
 * the composer's one popover, under the grip.
 *
 * Built on Angular Aria's menu like the cell's: the keys are the menu's
 * while it is up, the colour list opens beside its row (`SubmenuPlacement`,
 * with menu-aim's grace on the way, `MenuSafeTriangle`), and it takes the
 * focus when it opens and hands it back to the text when it closes.
 * Background image turns the panel into a field for the address — Enter
 * sets it, an address that is neither http(s) nor a `{{ … }}` token turns
 * the field red, Escape leaves. Padding and Width are parts of the menu
 * itself: the band's room, three px fields — Top, Bottom and Inline (at the
 * sides) — and its content's cap, a px field with Full beside it (no cap;
 * the field disabled while it is on, and on a page's band row, whose width
 * is the page's) — each set as it changes (its arrows, a blur, the box),
 * Enter sets it and leaves. Their keys are the field's, not the menu's
 * typeahead; Tab from the rows reaches them. The caret stays in the band
 * throughout: every action is a caret-relative section command.
 *
 * A spacer's grip opens the same menu cut to Color and Remove — a filled
 * spacer is a strip — acting on the selected spacer; an authored page's
 * grip (a page edited by hand, recognised) opens it cut to Remove.
 * Suggestions hang left of the menu as a card, never a row of it, and
 * convert only when taken: beside a band that holds nothing but room, the
 * one filled spacer it stands for (`spacerOfBand`, `bandToSpacer`); beside
 * an authored page, the strip and bands it stands for (`authoredPageBands`,
 * `convertAuthoredPage`).
 */
@Component({
  selector: 'div[section-menu]',
  imports: [
    // Material
    MatIconModule,

    // Signal Forms
    FormField,
    FieldKeys,

    // Angular Aria
    Menu,
    MenuItem,
    MenuSafeTriangle,
    SubmenuPlacement,
    FloatingScrollbar,
  ],
  templateUrl: './section-menu.html',
  styleUrl: './section-menu.scss',
})
export class SectionMenu {
  readonly #commands = inject(FormattingCommands);

  /** The grip that was pressed — a band's or a spacer's. */
  readonly target = input.required<SectionHandleTarget | null>();

  readonly #state = editorState(() => this.#commands.editor());

  /** The menu asked to close — after an action, on Escape, on a click
      outside. The composer clears the target it passed in. */
  readonly closed = output<void>();

  /** The palette in use — its fills, as the colour list's rows. */
  protected readonly palette = injectPalette();

  protected readonly open = computed(() => !!this.target());

  /** Whose grip opened it: a band's, a spacer's (cut to its fill and
      Remove) or an authored page's (Remove, and the suggestion beside). */
  protected readonly kind = computed(() => this.target()?.kind ?? 'section');
  protected readonly spacer = computed(() => this.kind() === 'spacer');
  protected readonly page = computed(() => this.kind() === 'page');

  protected readonly labels = {
    section: 'Section options',
    spacer: 'Spacer options',
    page: 'Page options',
  } as const;
  protected readonly removeLabels = {
    section: 'Remove section',
    spacer: 'Remove spacer',
    page: 'Remove table',
  } as const;

  /** What the authored page whose grip opened the menu would be in our
      blocks — the card beside suggests it — or null where it is no longer
      the pattern. */
  protected readonly pageSuggested = computed(() => {
    const state = this.#state();
    const pos = this.target()?.sectionPos;
    if (!this.page() || !state || pos === undefined) return null;
    const node = state.doc.nodeAt(pos);
    return node ? authoredPageBands(node, state.schema) : null;
  });

  /** A conversion's button says what it makes: a spacer, sections, or
      both — the page card's, and the band card's (one spacer, always). */
  protected readonly pageConvertLabel = computed(() => {
    const conversion = this.pageSuggested();
    return conversion ? convertLabel(conversion) : '';
  });
  protected readonly spacerConvertLabel = convertLabel({ spacers: 1, sections: 0 });

  /** The page of rows the author meant: offered while the document has no
      page layout of its own; its column's width, for the card to say. */
  protected readonly rowsAvailable = computed(
    () => !!this.pageSuggested() && !this.#state()?.doc.attrs['pageLayout'],
  );
  protected readonly pageWidth = computed(() => this.pageSuggested()?.rows.layout.width ?? 0);

  /** The fill of the band the caret is in (or of the selected spacer), as
      lower-case hex — null for none: the colour list ticks it, a row of it
      sets it. */
  readonly #fill = sectionBackgroundModel(() => this.#commands.editor());
  protected readonly currentFill = computed(() => {
    if (!this.open()) return null;
    if (!this.spacer()) return this.#fill();
    const state = this.#state();
    const fill = state ? selectedSpacer(state)?.node.attrs['background'] : null;
    return typeof fill === 'string' ? fill.toLowerCase() : null;
  });

  /** The spacer a band holding nothing but room stands for — the card
      beside the menu suggests it; null for any other band. */
  protected readonly suggestion = computed(() => {
    const state = this.#state();
    return this.kind() === 'section' && this.open() && state ? spacerOfBand(state) : null;
  });

  /** The colour list's rows: each fill, and whether it is the band's. */
  protected readonly fills = computed(() => {
    const current = this.currentFill();
    return this.palette.background.map((color) => ({
      ...color,
      checked: color.value.toLowerCase() === current,
    }));
  });

  /** The panel shows the image field instead of the menu — Background
      image picked; back to the menu whenever another grip opens it. */
  protected readonly imageField = linkedSignal<SectionHandleTarget | null, boolean>({
    source: () => this.target(),
    computation: () => false,
  });

  /** What the field takes, said in it while empty — braces a template
      cannot write. */
  protected readonly imagePlaceholder = 'https://…/image.jpg or {{ field }}';

  /** What the field opened with: the band's image, or nothing. */
  protected readonly imageValue = signal('');

  /** The field holds an address that is neither an http(s) URL nor a
      `{{ … }}` token. */
  protected readonly imageRefused = signal(false);

  /** The room of the band the caret is in, px — its two fields: each
      written once it is done with (left, Enter, a step of its arrows), one
      step of the editor's, and shown as the band took it (on the grid, in
      range). */
  protected readonly padding = form(
    sectionPaddingModel(() => this.#commands.editor()),
    (room) => {
      for (const side of [room.top, room.bottom, room.inline]) {
        min(side, 0);
        max(side, SECTION_PADDING_MAX);
        debounce(side, 'blur');
      }
    },
  );

  protected readonly paddingStep = SECTION_PADDING_STEP;

  /** The band is a section — a page's band row has no width of its own. */
  protected readonly isSection = computed(() => {
    const state = this.#state();
    return !!state && !!findSectionContext(state);
  });

  /** The cap on the band's content — its px field and Full beside it:
      written like the padding's; the field disabled while Full is on, and
      both on a band row. */
  protected readonly width = form(
    sectionWidthModel(() => this.#commands.editor()),
    (band) => {
      min(band.width, SECTION_WIDTH_MIN);
      max(band.width, SECTION_WIDTH_MAX);
      debounce(band.width, 'blur');
      disabled(band.width, ({ valueOf }) => valueOf(band.full) || !this.isSection());
      disabled(band.full, () => !this.isSection());
    },
  );

  protected readonly widthStep = SECTION_WIDTH_STEP;

  /** The menu's element (or the field's), to put the focus in once it is
      on screen. */
  readonly element = viewChild<ElementRef<HTMLElement>>('menu');

  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly panel = viewChild<TemplateRef<unknown>>('panel');

  /** Under the grip, centred on it — over the band it is about, which the
      grip names; above it where the bottom has no room. */
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 6 },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -6 },
  ];

  constructor() {
    inject(Popover).register({
      layer: 'toolbar',
      open: () => this.open(),
      anchor: () => this.target()?.boundingBox ?? null,
      content: this.panel,
      positions: () => this.positions,
      onOutsideClick: () => this.closed.emit(),
      close: () => this.leave(),
    });
    // The keys are the menu's while it is up: focus goes in — onto the
    // active row (roving focus: the one row with `tabindex="0"`, set by
    // the menu's own render, hence one render later), or into the field —
    // once the popover has rendered it.
    const injector = inject(Injector);
    effect(() => {
      const field = this.imageField();
      const menu = this.open() ? this.element()?.nativeElement : undefined;
      if (!menu) return;
      untracked(() =>
        afterNextRender(
          {
            write: () => {
              if (field) {
                menu.querySelector<HTMLInputElement>('input')?.select();
                return;
              }
              const row = menu.querySelector<HTMLElement>('[tabindex="0"], [ngMenuItem]');
              (row ?? menu).focus();
            },
          },
          { injector },
        ),
      );
    });
  }

  protected pick(action: SectionAction): void {
    const [kind, value = ''] = action.split(':') as [string, string?];
    switch (kind) {
      case 'fill':
        if (this.spacer()) this.#run('setSpacerBackground', value || null);
        else {
          this.#fill.set(value || null);
          this.#done();
        }
        break;
      case 'image':
        this.imageValue.set(this.#sectionImage() ?? '');
        this.imageRefused.set(false);
        this.imageField.set(true);
        break;
      case 'remove':
        if (this.spacer()) {
          this.#commands.editor()?.exec((state, dispatch) => {
            dispatch?.(state.tr.deleteSelection().scrollIntoView());
            return true;
          });
          this.#done();
        } else if (this.page()) {
          const pos = this.target()?.sectionPos;
          this.#commands.editor()?.exec((state, dispatch) => {
            const node = pos === undefined ? null : state.doc.nodeAt(pos);
            if (!node || pos === undefined) return false;
            dispatch?.(state.tr.delete(pos, pos + node.nodeSize).scrollIntoView());
            return true;
          });
          this.#done();
        } else this.#run('removeSection');
        break;
      default:
        return; // a list's row: opening it is Aria's
    }
  }

  /** Whether the band under the caret has an image — the field's "remove
      image" button shows then. */
  protected hasImage(): boolean {
    return !!this.imageValue();
  }

  /** Enter in the field, or its remove button: the band's image is set (or,
      empty, taken away); refused, the field says so and keeps the caret. */
  protected setImage(raw: string): void {
    const editor = this.#commands.editor();
    if (!editor) return;
    const url = raw.trim();
    if (!editor.commands['setSectionImage'](url || null)) {
      this.imageRefused.set(true);
      return;
    }
    this.#done();
  }

  /** The card's Use a spacer: the band goes, the one spacer it stands for
      in its place, selected. */
  protected useSpacer(): void {
    this.#run('bandToSpacer');
  }

  /** The page card's Convert: the authored page becomes the
      strip and the bands it stands for — the author's call, one undo step. */
  protected convertPage(): void {
    const pos = this.target()?.sectionPos;
    if (pos !== undefined) this.#commands.editor()?.exec(convertAuthoredPage(pos));
    this.#done();
  }

  /** The page card's Convert to page of rows: the rows in a column on the
      page's colour, the document's layout set — one undo step. */
  protected convertPageToRows(): void {
    const pos = this.target()?.sectionPos;
    if (pos !== undefined) this.#commands.editor()?.exec(convertAuthoredPageToRows(pos));
    this.#done();
  }

  /** Enter in a padding field: set, and the menu closes. */
  protected applied(): void {
    this.#done();
  }

  /** Escape: the menu closes and the caret goes back to the text. */
  protected leave(): void {
    this.closed.emit();
    this.#commands.focus();
  }

  #sectionImage(): string | null {
    const editor = this.#commands.editor();
    if (!editor) return null;
    return (findBandContext(editor.state)?.node.attrs['image'] as string | null) ?? null;
  }

  #run(command: string, ...args: unknown[]): void {
    this.#commands.editor()?.commands[command]?.(...args);
    this.#done();
  }

  /** An action closes the menu and hands the caret back. */
  #done(): void {
    this.closed.emit();
    this.#commands.editor()?.focus();
  }
}

/** What a conversion button says: what the conversion makes. */
function convertLabel({ spacers, sections }: { spacers: number; sections: number }): string {
  const made = [spacers ? 'spacer' : '', sections ? 'sections' : ''].filter(Boolean);
  return `Convert to ${made.join(' and ')}`;
}
