# Changelog

All notable changes to `@h-k-dev/angular-email-editor`. The library is pre-1.0: a minor
version may change behaviour, and says so here.

## Unreleased

### Changed — behaviour

- **A document's `prefers-color-scheme` rules follow the paper.** In the editor they used to
  follow the viewer's browser, which says nothing of the paper: a dark browser drew an
  email's dark rules on light paper. They now apply while the root matches the dark-paper
  selector, and `light` ones while it does not. `createDocumentStyles({ darkScope })` takes
  that selector — the one `createDarkRendering` takes as `scope`, same default
  (`DARK_PAPER_SCOPE`); a host with its own passes it to both. `scopedDocumentCss` now
  returns one `@scope` block per run of rules (any, dark, light) instead of always one.
- **An empty value keeps its token.** `createMergeTagResolution`'s `resolve` answering
  `''` for an expression used to remove its tokens; it now leaves them, like `null`
  (still reported in `MergeTagResolutionReport.empty`). An evaluator says `''` both for a
  field without a value and for one that computes to nothing, so the fill cannot tell a
  gap from an intent: removing a token is now always explicit (`removeMergeTag`). A host
  that relied on `''` deleting tokens calls `removeMergeTag(expr)` for those it means.
- **A held column says its own share.** `column.attrs.hold` is now the share itself, percent
  of the row (`ColumnHold`: a number, or `false` for a column that stacks), read from the
  `width: 50%` an author wrote and emitted as written. It used to be `true` and emit the
  cap's share of the 560px budget, so two 300px halves came out 54% each and wrapped on a
  phone. The boundary drag and the `+` / `−` pills keep the shares of a held row in step
  with its caps; `true` still reads, as before.

### Added

- **iOS's own links read as text.** `emailDocument`'s head carries a second rule, in a sheet
  of its own (`DATA_DETECTORS_RULE`): the links iOS Mail makes of dates, addresses and phone
  numbers (`a[x-apple-data-detectors]`) take the colour, face, size and weight of the words
  round them and lose their underline. They still open on a tap; an author's own links are
  not touched. A sent email now has two `<style>` elements in its head (three with a
  Stylesheet page).
- **MJML's group, offered as held columns.** A band whose cell holds one `mj-group` — a
  full-width `div` round columns that say their share themselves — is now recognised
  (`authoredBand`, `authoredColumns`): its band grip offers the section and a columns block
  whose columns keep that share on a phone instead of stacking (`AuthoredColumn.hold`,
  `heldShare`). Nothing converts on parse. A row shorter than a line of the type round it
  stands a line tall once converted (MJML's group says `line-height: 0`, our columns block
  says none).
- **The editor island** — a trigger takes its editor from where it stands, with nothing
  bound. `[emailActions]="editor | actions"` (`/actions`) on a toolbar gives every
  `[emailAction]` inside its list; `[emailEditor]` gives what is inside it its actions;
  a composer whose menus sit beside the editor, or open in an overlay, provides
  `EMAIL_EDITOR` and `EMAIL_ACTIONS` once for all of them. `injectActions()` with no
  editor reads the island's; a bare `emailImageAlt` / `emailImageSource` does too.
  `[emailActionFrom]` is now optional (`ActionTrigger.from()` may be `undefined`) and
  still wins where bound; a bare trigger on no island throws, saying what to bind.
  `EMAIL_EDITOR`, `injectEditor` and `EditorRef` now live in `/actions` and are still
  exported from `/editor`.
- **Filled values remember their token** — the `FilledMergeTag` mark (in
  `emailExtensions`, editor-only) on every value the fill puts in: `filledMergeTagAt`,
  `editFilledValue` (write over it by hand, still the token's), `resetFilledValue`,
  `restoreMergeTag`. An edited value carries `aee-filled-merge-tag--edited`.
- **Ctrl shows them** — while Ctrl is held (`LayoutGuides`' peek, which now dispatches
  `GUIDES_PEEK_EVENT` and exports `isPeeking`), `createMergeTagResolution`'s new
  `onFilledHover` reports the filled value under the pointer, with `edit`, `reset` and
  `restore` for a host's card.
- **One token by its expression** — `distinctMergeTagExpressions` (text and attributes,
  once each), `selectMergeTag`, `revealMergeTag`, `writeMergeTag` (a value by hand in
  every token's place), `removeMergeTag`.
- **Signal-forms check at send** (`/editor`) — `checkMergeTagValues(field, editor,
  { resolve })` returns a `MergeTagUnfilled` error (`mergeTag.unfilled`, with its `expr`)
  for each placeholder without a value; `isMergeTagUnfilled`. `EmailEditor` takes the
  field's `errors` and its `focus()` — the form's `focusBoundControl` — selects the named
  token and emits `(emailEditorMergeTagRevealed)` with the element, for a card beside it.
- **`styles/merge-tags`** — the pill and the filled-value look as a Sass mixin
  (`@include merge-tags.merge-tags` on `.aee-editor`), on `--email-merge-tag-background`
  and `--email-merge-tag-edited`.
- `clearFormatting` leaves a mark whose spec says `clearable: false`.

### Fixed

- **A document's body rules reach the editor's root.** `DocumentStyles` put the `<body>`'s
  inline style on the root, but a rule of the head for the body (`body { … }`, `body.page`,
  `[dir="rtl"] body`) matched nothing inside the editor's `@scope`. Such a rule is now read
  against the body the document has and, where it matches, said of the root — over a host's
  own surface rules, under the inline style. Its box stays out: `margin*` / `padding*` go
  to `--aee-body-*`, and `width`, `height`, `display`, `position` and the like are left
  behind. `body td` is read the same way and keeps its weight. An email whose body turns
  black by a head rule in dark no longer shows a white strip under its last line.
- **On dark paper the body's own fill is drawn dark too.** `createDarkRendering` drew every
  inline colour dark except the root's — the `<body>`'s `bgcolor` or inline background, which
  stayed light under a dark email. The root's own style is now drawn dark like any other, and
  so are the colours of a body rule.
- **A page's room stays dark on dark paper.** Drawing the root's own style dark
  (above) also took its custom properties: the page layout's
  `--aee-page-background-dark`, already the dark fill, was drawn dark once more
  and came out light — light strips above and below a page on dark paper.
  `createDarkRendering` now leaves the root's custom properties as written.
- **A block link is no stored mistake.** `storedMistakes` counted an `<a>` round a table or a
  block — a card that is one link, `<a style="display:block"><table>…` — as
  `inline-around-blocks`, and `fixStoredMistakes` pushed the link inside. A link that says
  its own `display`, or that holds a table, now stays as written (`isBlockLink`). A link an
  editor wrapped round plain lines is still lowered into each.
- **A wrapper round a table goes into its cells.** `<font color><table>…</table></font>` was
  "fixed" to a `<font>` between the table and its rows, which a client moves out, empty — the
  cells lost the colour. It is now put inside each cell of that table.
