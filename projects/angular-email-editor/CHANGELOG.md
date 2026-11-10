# Changelog

All notable changes to `@h-k-dev/angular-email-editor`. The library is pre-1.0: a minor
version may change behaviour, and says so here.

## Unreleased

### Changed — behaviour

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

- **A block link is no stored mistake.** `storedMistakes` counted an `<a>` round a table or a
  block — a card that is one link, `<a style="display:block"><table>…` — as
  `inline-around-blocks`, and `fixStoredMistakes` pushed the link inside. A link that says
  its own `display`, or that holds a table, now stays as written (`isBlockLink`). A link an
  editor wrapped round plain lines is still lowered into each.
- **A wrapper round a table goes into its cells.** `<font color><table>…</table></font>` was
  "fixed" to a `<font>` between the table and its rows, which a client moves out, empty — the
  cells lost the colour. It is now put inside each cell of that table.
