/** One custom property. Prose marks code with `backticks`. */
export interface TokenEntry {
  readonly name: string;
  /** The M3 system variable it falls back to, or null when it has none. */
  readonly system: string | null;
  readonly fallback: string;
  readonly alters: string;
}

/** Tokens for one part of the UI — a topic of its section. */
export interface TokenGroup {
  /** The heading's id, and the URL's #fragment. */
  readonly id: string;
  readonly title: string;
  readonly tokens: readonly TokenEntry[];
}

/** A section of tokens. */
export interface TokenSection {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  readonly groups: readonly TokenGroup[];
}

/** A class the library stamps on its own DOM, for the host to style. */
export interface ClassHook {
  readonly name: string;
  readonly applies: string;
}

export interface HookGroup {
  readonly id: string;
  readonly title: string;
  readonly hooks: readonly ClassHook[];
}

/** The whole override contract in a few lines — at point of use. */
export const OVERRIDE_EXAMPLE = `/* Global, because the editable is created outside Angular's encapsulation. */
.aee-editor {
  --email-merge-tag-background: #fde7c3;
  --email-drop-line: #0b57d0;
}`;

export const MATERIAL_RECIPE = `<mat-form-field>
  <mat-label>To</mat-label>
  <div email-address-input emailMatFormField [formField]="envelope.to"></div>
  <mat-hint>Separate addresses with a comma</mat-hint>
  <mat-error>{{ envelope.to().errors()[0]?.message }}</mat-error>
</mat-form-field>`;

const PRIMARY_MIX = 'a mix over the primary';

export const TOKEN_SECTIONS: readonly TokenSection[] = [
  {
    id: 'editor-surface',
    title: 'Editor surface',
    intro:
      'The editable itself: caret, selection, drag, resize and diagnostics. These are editor-only affordances — none of them reach the HTML that gets mailed.',
    groups: [
      {
        id: 'caret-selection',
        title: 'Caret & selection',
        tokens: [
          {
            name: '--email-caret',
            system: '--mat-sys-on-surface',
            fallback: '#1f1f1f',
            alters: 'The gap cursor — the caret drawn where no text can go (beside a table, between two blocks).',
          },
          {
            name: '--email-text-selection',
            system: '--mat-sys-primary',
            fallback: PRIMARY_MIX,
            alters: 'The text highlight, and the tint over an image a text range covers, so both read as one.',
          },
          {
            name: '--email-drop-line',
            system: '--mat-sys-primary',
            fallback: '#6750a4',
            alters: 'The drop indicator for a dragged image or block.',
          },
        ],
      },
      {
        id: 'tables-columns',
        title: 'Tables & columns',
        tokens: [
          {
            name: '--email-cell-selection',
            system: '--mat-sys-primary',
            fallback: PRIMARY_MIX,
            alters: 'Fill of a shift-dragged rectangle of table cells.',
          },
          {
            name: '--email-cell-selection-border',
            system: '--mat-sys-primary',
            fallback: '#4c6ef5',
            alters: 'Edges of that rectangle, and the frame around the active cell.',
          },
          {
            name: '--email-column-resize',
            system: '--mat-sys-primary',
            fallback: '#4c6ef5',
            alters: 'The column boundary while a table column is resized.',
          },
          {
            name: '--email-table-grid',
            system: null,
            fallback: 'light-dark(rgb(230, 229, 227), #383836)',
            alters: 'Grid lines a table shows while it is being worked on.',
          },
          {
            name: '--email-layout-guide',
            system: '--email-table-grid',
            fallback: 'light-dark(rgb(230, 229, 227), #383836)',
            alters: 'The guides tables and column blocks peek on hover (`.aee-guides-peek`).',
          },
          {
            name: '--email-grip-halo',
            system: null,
            fallback: '#ffffff',
            alters: 'The halo around a table grip or add pill floating over text. Set it to the paper colour.',
          },
        ],
      },
      {
        id: 'images',
        title: 'Images',
        tokens: [
          {
            name: '--email-image-selection',
            system: '--mat-sys-primary',
            fallback: PRIMARY_MIX,
            alters: 'Tint over an image selected on its own (clicked).',
          },
          {
            name: '--email-image-resize-frame',
            system: '--mat-sys-primary',
            fallback: '#4c6ef5',
            alters: 'The frame around an image while it is resized.',
          },
          {
            name: '--email-image-pad',
            system: '--mat-sys-primary',
            fallback: '#4c6ef5',
            alters: 'The resize handles.',
          },
          {
            name: '--email-image-placeholder-background',
            system: '--mat-sys-surface-container',
            fallback: '#f3f3f3',
            alters: 'The empty image placeholder, before a file is picked.',
          },
          {
            name: '--email-image-placeholder-border',
            system: '--mat-sys-outline-variant',
            fallback: '#c4c7c5',
            alters: 'Its border.',
          },
          {
            name: '--email-image-missing-background',
            system: '--mat-sys-surface-container',
            fallback: '#f3f3f3',
            alters: 'An image whose `cid:` part the registry cannot resolve.',
          },
          {
            name: '--email-image-missing-border',
            system: '--mat-sys-error',
            fallback: '#b3261e',
            alters: 'Its border.',
          },
        ],
      },
      {
        id: 'tags-quotes',
        title: 'Merge tags & quoted history',
        tokens: [
          {
            name: '--email-merge-tag-background',
            system: '--mat-sys-primary',
            fallback: PRIMARY_MIX,
            alters: 'The merge-tag pill around a personalization token.',
          },
          {
            name: '--email-expression-error',
            system: '--mat-sys-error',
            fallback: '#b3261e',
            alters: 'The wavy underline under an expression the dialect cannot parse.',
          },
          {
            name: '--email-quote-fold-background',
            system: '--mat-sys-surface-container-high',
            fallback: '#e2e2e2',
            alters: 'The ⋯ button that folds the quoted history away.',
          },
          {
            name: '--email-quote-fold-background-hover',
            system: '--mat-sys-surface-container-highest',
            fallback: '#d4d4d4',
            alters: 'That button under the pointer.',
          },
          {
            name: '--email-quote-fold-corner',
            system: '--mat-sys-corner-small',
            fallback: '6px',
            alters: 'Its corner radius.',
          },
        ],
      },
    ],
  },
  {
    id: 'composer-chrome',
    title: 'Composer chrome',
    intro:
      'The panes this example app builds around the editor — menus, pickers, the status strip, the preview. Component-scoped, and the first thing to re-skin in a host with its own look.',
    groups: [
      {
        id: 'menus',
        title: 'Menus',
        tokens: [
          {
            name: '--email-compose-menu-background',
            system: '--mat-sys-surface-container',
            fallback: '#f3f3f3',
            alters: 'The bubble, block and slash menus.',
          },
          {
            name: '--email-compose-menu-hover',
            system: '--mat-sys-surface-bright',
            fallback: '#ffffff',
            alters: 'A row under the pointer.',
          },
          {
            name: '--email-compose-menu-corner',
            system: '--mat-sys-corner-medium',
            fallback: '8px',
            alters: 'Their corner radius.',
          },
        ],
      },
      {
        id: 'pickers',
        title: 'Colour pickers',
        tokens: [
          {
            name: '--email-compose-palette-background',
            system: '--mat-sys-surface-container',
            fallback: '#f3f3f3',
            alters: 'The text and background colour pickers.',
          },
          {
            name: '--email-compose-palette-outline',
            system: '--mat-sys-outline',
            fallback: '#777777',
            alters: 'Their outline.',
          },
          {
            name: '--email-compose-palette-corner',
            system: '--mat-sys-corner-medium',
            fallback: '8px',
            alters: 'Their corner radius.',
          },
          {
            name: '--email-compose-palette-swatch-outline',
            system: null,
            fallback: 'rgba(0, 0, 0, 0.12)',
            alters: 'The ring around each swatch, so a white swatch stays visible.',
          },
          {
            name: '--email-swatch',
            system: null,
            fallback: '—',
            alters: 'Read-only: set on each swatch button to that swatch’s own colour.',
          },
        ],
      },
      {
        id: 'link-editor',
        title: 'Link editor',
        tokens: [
          {
            name: '--email-compose-link-background',
            system: '--mat-sys-surface-container',
            fallback: '#f3f3f3',
            alters: 'The link editor.',
          },
          {
            name: '--email-compose-link-input-background',
            system: '--mat-sys-surface-bright',
            fallback: '#ffffff',
            alters: 'Its input.',
          },
          {
            name: '--email-compose-link-corner',
            system: '--mat-sys-corner-medium',
            fallback: '8px',
            alters: 'Its corner radius.',
          },
        ],
      },
      {
        id: 'status-preview',
        title: 'Status strip & preview',
        tokens: [
          {
            name: '--email-compose-status-error',
            system: '--mat-sys-error',
            fallback: '#b3261e',
            alters: 'The status strip’s error count, and the size gauge past its budget.',
          },
          {
            name: '--email-compose-status-warning',
            system: '--mat-sys-aee-lint-warning',
            fallback: '#b06000',
            alters: 'The status strip’s warning count.',
          },
          {
            name: '--email-compose-status-font',
            system: '--mat-sys-body-small',
            fallback: '12px sans-serif',
            alters: 'The status strip’s typography (a full `font` shorthand).',
          },
          {
            name: '--email-preview-stage-background',
            system: '--mat-sys-surface-container-low',
            fallback: '#fafafa',
            alters: 'The stage behind the rendered mail in the preview.',
          },
          {
            name: '--email-preview-controls-background',
            system: '--mat-sys-surface-container',
            fallback: '#f3f3f3',
            alters: 'The preview’s control bar.',
          },
          {
            name: '--email-preview-corner',
            system: '--mat-sys-corner-medium',
            fallback: '8px',
            alters: 'The preview pane’s corner radius.',
          },
        ],
      },
    ],
  },
  {
    id: 'source-scrollbars',
    title: 'Source pane & scrollbars',
    intro:
      'The HTML source editor colours its tokens from M3 roles directly, so it follows the theme unchanged; only the two roles M3 has no equivalent for are extra tokens.',
    groups: [
      {
        id: 'source-pane',
        title: 'Source pane',
        tokens: [
          {
            name: '--mat-sys-aee-tok-value',
            system: null,
            fallback: '#188038',
            alters:
              'Attribute values. Tags use `--mat-sys-primary`, attribute names `--mat-sys-tertiary`, delimiters and comments `--mat-sys-outline`.',
          },
          {
            name: '--mat-sys-aee-lint-warning',
            system: null,
            fallback: '#b06000',
            alters: 'The wavy underline under a lint warning. Errors use `--mat-sys-error`.',
          },
        ],
      },
      {
        id: 'scrollbars',
        title: 'Scrollbars',
        tokens: [
          {
            name: '--email-scroll-size',
            system: null,
            fallback: '8px',
            alters: 'Thickness of every scrollbar (the library’s scroll mixin, `.email-scroll`) and of the gutter it keeps.',
          },
          {
            name: '--email-scroll-thumb',
            system: '--mat-sys-outline-variant',
            fallback: 'the outline variant at 50%',
            alters: 'The thumb while the scroller is hovered or focused.',
          },
          {
            name: '--email-scroll-thumb-hover',
            system: '--mat-sys-outline-variant',
            fallback: 'the outline variant at 75%',
            alters: 'The thumb under the pointer.',
          },
          {
            name: '--email-scroll-track',
            system: null,
            fallback: 'transparent',
            alters: 'The track behind the thumb.',
          },
        ],
      },
    ],
  },
  {
    id: 'layout-spacing',
    title: 'Layout & spacing',
    intro:
      'Sizing, not colour. The block gutter is the one to know: it makes room for a block’s affordances (add pills, resize handles) without narrowing the text — negative inline margins hang it into the surface margin, which the host reserves.',
    groups: [
      {
        id: 'gutter-spacing',
        title: 'Gutter & spacing',
        tokens: [
          {
            name: '--aee-block-gutter-x',
            system: null,
            fallback: '20px, declared per block wrapper',
            alters: 'The inline-direction gutter around a table or column block, and everything positioned against it.',
          },
          {
            name: '--aee-block-gutter-y',
            system: null,
            fallback: '20px, declared per block wrapper',
            alters: 'The block-direction gutter around a table or column block.',
          },
          {
            name: '--mat-sys-inner-spacing',
            system: null,
            fallback: '16px — this app defines it',
            alters: 'Gaps and padding inside the composer’s panes.',
          },
          {
            name: '--mat-sys-outer-spacing',
            system: null,
            fallback: '24px — this app defines it',
            alters: 'The surface margin the block gutter hangs into.',
          },
          {
            name: '--mat-icon-size',
            system: null,
            fallback: '16px — this app defines it',
            alters:
              'Icon size app-wide, including menus in the CDK overlay container. Icon buttons size their own glyph (20px).',
          },
        ],
      },
    ],
  },
];

/** The classes the library stamps on its own runtime DOM. */
export const HOOK_GROUPS: readonly HookGroup[] = [
  {
    id: 'hooks-editor',
    title: 'Editor & selection',
    hooks: [
      {
        name: '.aee-editor',
        applies:
          'The identity class on every editable root the library mounts. Scope editor styles to it — never to bare `.ProseMirror`.',
      },
      {
        name: '.aee-atom--in-selection',
        applies:
          'An inline atom (an image, a button) covered by a text range. Browsers paint no selection on a non-editable element, so this is the highlight to draw; a clicked one carries `ProseMirror-selectednode` instead.',
      },
      {
        name: '.aee-drop-line',
        applies: 'The drop indicator, positioned against the editor’s offset parent.',
      },
    ],
  },
  {
    id: 'hooks-images',
    title: 'Images',
    hooks: [
      {
        name: '.aee-image · .aee-image--placeholder · .aee-image--resizing',
        applies: 'The inline image’s editor-only wrapper (`span.aee-image > img`), the empty placeholder, and the resize state.',
      },
    ],
  },
  {
    id: 'hooks-tables',
    title: 'Tables & columns',
    hooks: [
      {
        name: '.aee-table-wrap · .aee-columns-wrap · .aee-columns-box · .aee-column',
        applies: 'The block wrappers that own the gutter and carry the affordances; a `--resizing` modifier marks a drag in progress.',
      },
      {
        name: '.aee-add-pill · .aee-add-pill--row · .aee-add-pill--column · .aee-add-zone',
        applies: 'The add-row and add-column pills, and the hover zone that reveals them.',
      },
      {
        name: '.aee-sel-top · .aee-sel-right · .aee-sel-bottom · .aee-sel-left · .aee-cell-active',
        applies: 'The edges of a table cell selection, per cell, and the active cell inside it.',
      },
      {
        name: '.aee-col-line · .aee-col-line--drag · .aee-col-line--edge · .aee-col-boundaries',
        applies: 'Column resize boundaries in a table or a column block.',
      },
      {
        name: '.aee-guides-active · .aee-guides-peek',
        applies: 'Layout guides: shown while the caret is inside the block, peeked while the pointer hovers it.',
      },
    ],
  },
  {
    id: 'hooks-tags-quotes',
    title: 'Merge tags & quoted history',
    hooks: [
      {
        name: '.aee-merge-tag · .aee-expr-error',
        applies: 'The personalization pill, and the underline under an expression the dialect rejects.',
      },
      {
        name: '.aee-quoted · .aee-quote-fold',
        applies:
          'The quoted history after the body, and its ⋯ fold button. `data-folded` while folded; its parts (bar, fold, edit, remove, content) are `data-slot`s.',
      },
    ],
  },
  {
    id: 'hooks-source',
    title: 'Source pane',
    hooks: [
      {
        name: '.aee-code-line · .aee-tok-* · .aee-lint-error · .aee-lint-warning',
        applies:
          'One line per block, plus highlighting and lint decorations (tag, attr, value, delimiter, comment, expression, brace).',
      },
    ],
  },
];
