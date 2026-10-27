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

// Material
import { MatIconModule } from '@angular/material/icon';

// Angular Aria
import { Menu, MenuItem } from '@angular/aria/menu';

// CDK
import { ConnectedPosition } from '@angular/cdk/overlay';

// Library
import {
  SectionHandleTarget,
  findBandContext,
  toEmailSafeColor,
} from '@h-k-dev/angular-email-editor';
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
 * the field red, Escape leaves. The caret stays in the band throughout:
 * every action is a caret-relative section command.
 */
@Component({
  selector: 'div[section-menu]',
  imports: [
    // Material
    MatIconModule,

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

  /** The grip that was pressed — this menu's when it is a band's. */
  readonly target = input.required<SectionHandleTarget | null>();

  /** The menu asked to close — after an action, on Escape, on a click
      outside. The composer clears the target it passed in. */
  readonly closed = output<void>();

  /** The palette in use — its fills, as the colour list's rows. */
  protected readonly palette = injectPalette();

  protected readonly open = computed(() => this.target()?.kind === 'section');

  /** The band's fill as the menu opened on it, as lower-case hex — null
      for none: the colour list ticks it. */
  protected readonly currentFill = computed(() => {
    // Read again for every grip pressed — another band's, with the menu up.
    if (!this.target() || !this.open()) return null;
    const editor = this.#commands.editor();
    const fill = editor ? findBandContext(editor.state)?.node.attrs['background'] : null;
    return typeof fill === 'string' ? (toEmailSafeColor(fill)?.toLowerCase() ?? null) : null;
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
        this.#run('setSectionBackground', value || null);
        break;
      case 'image':
        this.imageValue.set(this.#sectionImage() ?? '');
        this.imageRefused.set(false);
        this.imageField.set(true);
        break;
      case 'remove':
        this.#run('removeSection');
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
