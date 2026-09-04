import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** One custom property, as the token tables render it. */
interface TokenEntry {
  name: string;
  /** The M3 system variable it falls back to, or null when it has none. */
  system: string | null;
  fallback: string;
  alters: string;
}

interface TokenGroup {
  title: string;
  hint: string;
  tokens: TokenEntry[];
}

/** A class the library stamps on its own DOM, for the host to style. */
interface ClassHook {
  name: string;
  applies: string;
}

/**
 * The styling page: every custom property that themes the composer, and the
 * class hooks underneath them. The editor's DOM is created by ProseMirror at
 * runtime — outside Angular's view encapsulation — so the surface is styled
 * globally, scoped to `.aee-editor` and never to bare `.ProseMirror`.
 */
@Component({
  selector: 'app-styling',
  imports: [RouterLink],
  templateUrl: './styling.html',
  styleUrl: './styling.scss',
})
export class Styling {
  /** The whole contract in six lines — one override, at point of use. */
  readonly example = `/* Global, because the editable is created outside Angular's encapsulation. */
.aee-editor {
  --email-merge-tag-background: #fde7c3;
  --email-drop-line: #0b57d0;
}`;

  readonly groups: TokenGroup[] = [
    {
      title: 'Editor surface',
      hint:
        'The editable itself: selection, drag, resize and diagnostic chrome. These are editor-only ' +
        'affordances — none of them reach the HTML that gets mailed.',
      tokens: [
        {
          name: '--email-caret',
          system: '--mat-sys-on-surface',
          fallback: '#1f1f1f',
          alters:
            'The gap cursor — the caret drawn at positions no text can hold (beside a table, between two blocks)',
        },
        {
          name: '--email-cell-selection',
          system: '--mat-sys-primary',
          fallback: 'color-mix over the primary',
          alters: 'Fill of a shift-dragged rectangle of table cells',
        },
        {
          name: '--email-cell-selection-border',
          system: '--mat-sys-primary',
          fallback: '#4c6ef5',
          alters: 'Edges of that rectangle, and the frame around the active cell',
        },
        {
          name: '--email-column-resize',
          system: '--mat-sys-primary',
          fallback: '#4c6ef5',
          alters: 'The column-boundary line while a table column is being resized',
        },
        {
          name: '--email-table-grid',
          system: null,
          fallback: 'rgb(224, 224, 224)',
          alters: 'Grid lines a table shows while it is being worked on',
        },
        {
          name: '--email-layout-guide',
          system: '--email-table-grid',
          fallback: 'rgb(224, 224, 224)',
          alters: 'The guides tables and column blocks peek on hover (.aee-guides-peek)',
        },
        {
          name: '--email-drop-line',
          system: '--mat-sys-primary',
          fallback: '#6750a4',
          alters: 'The drop indicator for a dragged image or block',
        },
        {
          name: '--email-merge-tag-background',
          system: '--mat-sys-primary',
          fallback: 'color-mix over the primary',
          alters: 'The merge-tag pill — editor-only chrome for a personalization token',
        },
        {
          name: '--email-image-selection',
          system: '--mat-sys-primary',
          fallback: 'color-mix over the primary',
          alters: 'Tint over a selected inline image',
        },
        {
          name: '--email-image-resize-frame',
          system: '--mat-sys-primary',
          fallback: '#4c6ef5',
          alters: 'The frame drawn around an image while it is resized',
        },
        {
          name: '--email-image-pad',
          system: '--mat-sys-primary',
          fallback: '#4c6ef5',
          alters: 'The image resize handles',
        },
        {
          name: '--email-image-placeholder-background / --email-image-placeholder-border',
          system: '--mat-sys-surface-container / --mat-sys-outline-variant',
          fallback: '#f3f3f3 / #c4c7c5',
          alters: 'The empty image placeholder, before a file is picked',
        },
        {
          name: '--email-image-missing-background / --email-image-missing-border',
          system: '--mat-sys-surface-container / --mat-sys-error',
          fallback: '#f3f3f3 / #b3261e',
          alters: 'An image whose cid: part the registry cannot resolve',
        },
        {
          name: '--email-quote-fold-background / --email-quote-fold-background-hover',
          system: '--mat-sys-surface-container-high / --mat-sys-surface-container-highest',
          fallback: '#e2e2e2 / #d4d4d4',
          alters: 'The button that folds the quoted history away',
        },
        {
          name: '--email-quote-fold-corner',
          system: '--mat-sys-corner-small',
          fallback: '6px',
          alters: 'Corner radius of that button',
        },
        {
          name: '--email-expression-error',
          system: '--mat-sys-error',
          fallback: '#b3261e',
          alters: 'The wavy underline under an expression the dialect cannot parse',
        },
      ],
    },
    {
      title: 'Composer chrome',
      hint:
        'The panes this example app builds around the editor — menus, pickers, the status strip, ' +
        'the preview. Component-scoped, and the first thing to re-skin when the composer is ' +
        'dropped into a host with its own look.',
      tokens: [
        {
          name: '--email-compose-menu-background / --email-compose-menu-hover',
          system: '--mat-sys-surface-container / --mat-sys-surface-bright',
          fallback: '#f3f3f3 / #ffffff',
          alters: 'The bubble, block and slash menus',
        },
        {
          name: '--email-compose-menu-corner',
          system: '--mat-sys-corner-medium',
          fallback: '8px',
          alters: 'Corner radius of those menus',
        },
        {
          name: '--email-compose-palette-background / --email-compose-palette-outline',
          system: '--mat-sys-surface-container / --mat-sys-outline',
          fallback: '#f3f3f3 / #777777',
          alters: 'The colour pickers (text and background)',
        },
        {
          name: '--email-compose-palette-corner',
          system: '--mat-sys-corner-medium',
          fallback: '8px',
          alters: 'Corner radius of the pickers',
        },
        {
          name: '--email-compose-palette-swatch-outline',
          system: null,
          fallback: 'rgba(0, 0, 0, 0.12)',
          alters: 'Ring around each swatch — so a white swatch is still visible',
        },
        {
          name: '--email-swatch',
          system: null,
          fallback: '—',
          alters: 'Read-only: the picker sets it per swatch button to that swatch’s own colour',
        },
        {
          name: '--email-compose-link-background / --email-compose-link-input-background',
          system: '--mat-sys-surface-container / --mat-sys-surface-bright',
          fallback: '#f3f3f3 / #ffffff',
          alters: 'The link editor and its input',
        },
        {
          name: '--email-compose-link-corner',
          system: '--mat-sys-corner-medium',
          fallback: '8px',
          alters: 'Corner radius of the link editor',
        },
        {
          name: '--email-compose-status-error / --email-compose-status-warning',
          system: '--mat-sys-error / --mat-sys-aee-lint-warning',
          fallback: '#b3261e / #b06000',
          alters: 'The status strip’s issue counts and the size gauge past its budget',
        },
        {
          name: '--email-compose-status-font',
          system: '--mat-sys-body-small',
          fallback: '12px sans-serif',
          alters: 'Typography of the status strip (full font shorthand)',
        },
        {
          name: '--email-preview-stage-background / --email-preview-controls-background',
          system: '--mat-sys-surface-container-low / --mat-sys-surface-container',
          fallback: '#fafafa / #f3f3f3',
          alters: 'The preview’s stage behind the rendered mail, and its control bar',
        },
        {
          name: '--email-preview-corner',
          system: '--mat-sys-corner-medium',
          fallback: '8px',
          alters: 'Corner radius of the preview pane',
        },
      ],
    },
    {
      title: 'Source pane & scrollbars',
      hint:
        'The HTML source editor colours its tokens from the M3 roles directly, so it inherits the ' +
        'theme unchanged; only the two roles M3 has no equivalent for are extension tokens.',
      tokens: [
        {
          name: '--mat-sys-aee-tok-value',
          system: null,
          fallback: '#188038',
          alters:
            'Attribute values in the source pane (tags use --mat-sys-primary, attributes --mat-sys-tertiary, delimiters and comments --mat-sys-outline)',
        },
        {
          name: '--mat-sys-aee-lint-warning',
          system: null,
          fallback: '#b06000',
          alters: 'The wavy underline under a lint warning (errors use --mat-sys-error)',
        },
        {
          name: '--mat-sys-scrollbar-size',
          system: null,
          fallback: '6 (unitless, multiplied by 1px)',
          alters: 'Width of the composer’s subtle scrollbars (.scroll-container)',
        },
        {
          name: '--mat-sys-scrollbar-thumb-color / --mat-sys-scrollbar-thumb-hover-color',
          system: '--mat-sys-outline-variant',
          fallback: 'the outline variant at 50% / 75% alpha',
          alters: 'Thumb colour at rest and under the pointer',
        },
      ],
    },
    {
      title: 'Layout & spacing',
      hint:
        'Sizing, not colour. The block gutter is the one to know: it reserves room for a block’s ' +
        'affordances (add pills, resize handles) without narrowing the text column — negative ' +
        'inline margins hang the gutter into the surface margin, which the host reserves.',
      tokens: [
        {
          name: '--aee-block-gutter-x / --aee-block-gutter-y',
          system: null,
          fallback: '20px (declared per block wrapper)',
          alters: 'The gutter around a table or column block, and everything positioned against it',
        },
        {
          name: '--mat-sys-inner-spacing',
          system: null,
          fallback: '16px (this app defines it)',
          alters: 'Gaps and padding inside the composer’s panes',
        },
        {
          name: '--mat-sys-outer-spacing',
          system: null,
          fallback: '24px (this app defines it)',
          alters: 'The surface margin the block gutter hangs into',
        },
        {
          name: '--mat-icon-size',
          system: null,
          fallback: '16px (this app defines it)',
          alters:
            'Icon size app-wide, including the menus that render in the CDK overlay container',
        },
      ],
    },
  ];

  /** The classes the library stamps on its own runtime DOM. */
  readonly hooks: ClassHook[] = [
    {
      name: '.aee-editor',
      applies:
        'The identity class on every editable root the library mounts. Scope editor styles to it, never to bare .ProseMirror — a ProseMirror instance the host runs for something else must be left alone.',
    },
    {
      name: '.aee-image, .aee-image--placeholder, .aee-image--resizing',
      applies:
        'The inline image’s editor-only wrapper (span.aee-image > img), the empty placeholder, and the resize state.',
    },
    {
      name: '.aee-table-wrap, .aee-columns-wrap, .aee-columns-box, .aee-column',
      applies:
        'The block wrappers that own the gutter and carry the affordances; --modifier--resizing marks a drag in progress.',
    },
    {
      name: '.aee-add-pill, .aee-add-pill--row, .aee-add-pill--column, .aee-add-zone',
      applies: 'The add-row and add-column affordances, and the hover zone that reveals them.',
    },
    {
      name: '.aee-sel-top, .aee-sel-right, .aee-sel-bottom, .aee-sel-left, .aee-cell-active',
      applies: 'Per-cell edges of a table cell selection, and the active cell inside it.',
    },
    {
      name: '.aee-col-line, .aee-col-line--drag, .aee-col-line--edge, .aee-col-boundaries',
      applies: 'The column resize boundaries in a table or a column block.',
    },
    {
      name: '.aee-guides-active, .aee-guides-peek',
      applies:
        'Layout guides: shown while the caret is inside the block, peeked while the pointer hovers it.',
    },
    {
      name: '.aee-merge-tag, .aee-expr-error',
      applies:
        'The personalization pill, and the underline under an expression the dialect rejects.',
    },
    {
      name: '.aee-quote-fold, .aee-quote-folded',
      applies: 'The quoted-history fold button, and the document while the history is folded.',
    },
    {
      name: '.aee-drop-line',
      applies: 'The drop indicator, positioned against the editor’s offset parent.',
    },
    {
      name: '.aee-code-line, .aee-tok-*, .aee-lint-error, .aee-lint-warning',
      applies:
        'The source pane: one line per block, plus highlighting and lint decorations (tag, attr, value, delimiter, comment, expression, brace).',
    },
  ];
}
