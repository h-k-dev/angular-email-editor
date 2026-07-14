# ROADMAP

Two editors, one document, zero lies: a visual email composer and an HTML
source editor developed as peers over the same extension contract, kept in
sync through Angular signals, with ProseMirror as the parsing engine on both
sides.

## Progress snapshot — 2026-07-13

Foundations and the two-editor core are in; the content and layout-blocks side
is mature. Tests: **179 library + 4 app, all green**.

| Milestone | State | Left to do |
| --- | --- | --- |
| Foundations (two editors, mark parity, canonical `html` signal) | ✅ done | — |
| **M1 — Round-trip fidelity** | ✅ core done | selection mirroring (stretch) |
| **M2 — Missing composer features** | 🟢 nearly done | word/line counter placement; `/send` |
| **M3 — Deliverability lint engine** | ✅ done | — |
| **M4 — Preview & proof** | 🟢 mostly done | per-client simulation; Outlook conditional comments |
| **M5 — Layout blocks** | 🟢 flagship done | add/remove-column UI; section-schema + `{{template}}` placeholders |
| **M6 — Compose workflow** | ⬜ not started | `/send`, drafts, reply/forward, `.eml`/HTML import, attachments |

Most recent work: **font size/family** (curated email-safe stacks +
phone-safe sizes, both merged onto the shared `textStyle` span, toolbar
pickers mirroring the colour palette) — closing most of M2. Before that:
**`/columns`** (responsive layout block that stacks on phones, no media
queries), **paste-a-URL-onto-selection** linking, and the **table
simplification** — the fiddly Notion-style overlay was tried and reverted in
favour of a plain table with an editor-only grid (shown only while the cursor
is inside it) plus an ArrowDown escape so you can always write underneath.
Next candidates: the word/line **counter placement** + **`/send`** to finish
M2, or open the M6 compose-workflow arc.

## Why this is worth building

Email is a strange dialect of HTML. It is parsed by rendering engines that
range from "a browser from 2012" to "Microsoft Word", it gets rewritten by
providers in transit, and it fails silently — the recipient just sees a broken
message. Every WYSIWYG email editor eventually hits the same wall: the visual
layer promises things the HTML underneath can't deliver.

Our answer is to make the HTML a first-class, always-visible, always-editable
projection — and to make one schema the single source of truth for what email
HTML is allowed to be.

## Principles (opinionated on purpose)

1. **The schema is law.** The email ProseMirror schema defines the entire
   vocabulary: which tags, which marks, which inline styles. Anything outside
   it does not survive — not as a bug, as the contract.
2. **Parsing is repair.** Broken or foreign markup is never rejected; it is
   parsed, normalized, and re-serialized into canonical form. The linter tells
   you *what* would change, the round-trip *makes* it change.
3. **Canonical output is deterministic.** Same document → byte-identical
   HTML: zero formatting whitespace, `<div>` lines (never `<p>` margins),
   `<div><br></div>` empty lines, inline styles only, stable attribute order.
4. **Formatting is presentation-only.** Indentation and line breaks in the
   source pane are exactly the whitespace the parser discards. Pretty source
   can never change the rendered email — this is enforced by test.
5. **Both editors run the same commands.** Ctrl-B in the source pane executes
   the visual editor's own toggle through the shared schema. Behavior can't
   diverge, because there is only one behavior.
6. **Signals carry the truth.** One `html` signal per composer; each editor
   projects into it and reacts to it. No event soup, no manual sync calls.
7. **If a mainstream client can't render it, we don't emit it.** Gmail,
   Outlook (Word engine), Apple Mail, Yahoo, and the big webmailers define
   our floor. When in doubt: caniemail says no.
8. **Responsive by default.** Every email we emit must read well on a phone —
   not as an option, as a property of the output. And because of principle 7,
   responsiveness is achieved *fluidly* (max-widths, percentage widths,
   wrapping structures with inline styles), never via `<style>` media
   queries that half the clients strip.
9. **We don't fight dark mode.** There is no reliable control — Gmail and
   Outlook forcibly recolor, and the official mechanisms don't survive
   transit — so we never emit dark-mode CSS or anti-inversion hacks. Instead
   the output *inverts gracefully by construction*: colorless by default
   (uncolored email is every inverter's happy path), and every color *we
   offer* passes the **dual-contrast rule** — readable against both white
   and near-black. Enforcement lives at the affordance: the color picker is
   a curated palette, not an arbitrary hex input. The source pane stays
   free — a hand-typed hex is the author's own responsibility; we never
   rewrite, block, or police colors from the code side.

## UI/UX & platform stance

- **Headless first: Angular Aria over Angular Material.** Behavior and
  accessibility come from headless primitives (Angular Aria patterns, CDK
  overlays); we own the markup and the pixels. Ideally we use no Material
  *components* at all — but we'll see, and we say so honestly: today's
  toolbar still sits on `mat-icon-button`. What we keep regardless is
  Material's **design token system**: `mat-sys-*` as the theming default is
  too nice and simple to pass on.
  - [ ] Migrate the composer UI (toolbar, menus) from Material components to
        headless Aria/CDK primitives styled purely by the token cascade.
- **One token cascade, always.** Every visual knob resolves in this exact
  sequence: `--email-*` / `--html-email-*` (our component tokens) →
  `--mat-sys-*` (Material system tokens) → hard fallback value. Host apps
  theme by overriding the first layer, Material themes flow through the
  second, and the fallback guarantees a sane look with no theme at all.
  - [ ] Migrate the existing names (`--mat-sys-prose-mirror-*`,
        `--mat-sys-aee-*`, `aee-*` token classes) onto this cascade.
- **Angular only — and all of Angular.** We will never care about other
  frontend frameworks or a framework-agnostic/vanilla-JS wrapper. That budget
  goes into seamless Angular integration instead: signals and `model()` for
  state, `effect()` for projections, `afterNextRender` for DOM mounting,
  OnPush everywhere, zoneless-ready.
- **No hacking into ProseMirror or Angular.** ProseMirror is extended only
  through its public contract (schema specs, plugins, props, decorations);
  Angular only through documented APIs. If a feature needs a private
  override or monkey patch, the feature waits or the design changes —
  maintenance beats cleverness.
- **Tests pin logic, not lines.** No 100%-coverage worship. We test the
  contracts that keep us honest — canonicalization, round-trip invariance,
  lint semantics, toggle parity — so refactors fail loudly exactly where it
  matters and nowhere else.

## Where we are (done)

- [x] Extension architecture: nodes, marks, keymaps, input rules, plugins,
      commands, slash items — kits are just arrays of extensions.
- [x] **Email kit**: div-line paragraphs, bold/italic/underline/strike,
      links, text color, blockquote, lists, headings, images, history,
      bubble menu, slash menu, math-only text metrics.
- [x] **HTML source kit**: one `codeLine` per line, syntax highlighting,
      linting (unclosed tags, stray closers, void misuse, non-email-safe
      warnings), pretty-printer that is also a repairer, Shift-Alt-F,
      format-on-blur (refuses on errors, Prettier-style), Tab = 2 spaces,
      auto-indent on Enter, tag auto-closing (`>` and `</`), line-aware paste.
- [x] **Mark parity**: mark keymaps/commands of the email kit mirrored into
      the source editor via sentinel round-trip through the shared schema.
- [x] **Composer app**: `Compose` owns one canonical `html` signal; the two
      panes are attribute-selector components with `model()` two-way binding;
      focus-guarded effects prevent echo loops and cursor yanking.
- [x] Output-invariance test: `format(html)` and `html` canonicalize
      identically through the email schema.

## Milestone 1 — Round-trip fidelity

The sync works; now make it lossless and gentle.

- [x] **Diff-based `setText`/`setContent`**: syncs apply as minimal diff
      transactions (`findDiffStart`/`findDiffEnd`), flagged `addToHistory:
      false` + `externalSync`. The receiving editor keeps its own undo
      history (external changes aren't yours to undo — collab semantics),
      its selection maps through the diff, and `onUpdate` stays silent so
      mirrored editors cannot echo.
- [x] **Comment policy — decided: comments are never content.** They drop on
      parse, but *loudly*: the linter warns on every comment ("the schema
      drops them on the next parse") and errors on unterminated ones. No
      comment node in the schema, ever. Where Outlook conditionals are needed
      (M5 ghost tables), the block extension's *serializer* generates them
      deterministically and its parser ignores them — comments as derived
      serializer artifacts, never editable state, so the round trip stays
      stable and nothing hides in the document.
- [x] **Entity discipline**: the linter warns on *ambiguous* ampersands —
      entity-like forms missing the `;` (`&copy`, `&#38`) that browsers
      legacy-decode, silently changing the text. Plain `&` in prose and bare
      `<` in text are left alone: the round trip normalizes them without
      changing meaning, and normalization is not worth a nag. Character
      references are atomic to the sentinel round-trip — selection endpoints
      inside `&amp;` expand outward, never splitting the reference.
- [ ] **Selection mirroring** (stretch): click in the source highlights the
      corresponding text in the email pane and back — generalize the sentinel
      offset-mapping into a reusable source map.

## Milestone 2 — The missing composer features

Everything a Gmail-class composer has that we don't, always expressed as
schema extensions first, toolbar second.

- [x] **Paste sanitization**: the `PasteHygiene` extension cleans clipboard
      HTML before the schema parse — `<style>`/`<script>` subtrees (whose
      text would leak through), Word's namespaced tags (`<o:p>`, `<w:*>`),
      and Word's fake list glyphs (`mso-list:Ignore` spans). Everything else
      (class soup, `mso-*` styles, Google Docs' `font-weight:normal` `<b>`
      wrapper) dies in the schema parse, where it belongs. Known limit: Word
      lists arrive as plain paragraphs (glyphs stripped, structure not
      reconstructed) — real `<ul>` reconstruction from `mso-list` levels is
      its own future item.
- [x] **Link editing UI**: selection-anchored popover (edit/apply on Enter,
      open, unlink) replaces `window.prompt`; a bare cursor inside a link
      edits the *whole* link via the new `linkRangeAt` helper, and
      `setLink`/`unsetLink` learned the same. Typed URLs auto-link on the
      committing space (`www.` gets `https://`, trailing punctuation stays
      outside). Script URLs: refused by the schema on parse *and* on the
      command, and flagged as errors in the source pane. **Paste-to-link**:
      pasting a bare URL onto selected text links the text instead of
      replacing it (`linkPastePlugin`; `www.` gets `https://`, script URLs
      refused, non-URL/multi-word pastes fall through to normal paste).
- [x] **`/image` slash command**: opens the OS file picker and inserts the
      chosen image(s) at the cursor — the slash path mirroring the existing
      drop/paste pipeline.
- [x] **Images**: the Image node now serializes the ledger's hybrid sizing
      (`width` attribute for Outlook + `width:100%; max-width:<n>px;
      height:auto` for everyone else), caps widths at 600px on parse and on
      drop, never parses or emits `float`, and handles dropped/pasted image
      files (data-URL source, alt defaulted from the filename, natural width
      measured). Missing/empty alt is linted in the source pane. Open ends,
      deliberately: data-URLs are a stopgap until the `cid:`/attachment story
      (M6), and there is no alt/width *editing UI* yet — the source pane is
      the editor for those attrs for now.
- [x] **Alignment & direction**: paragraphs carry an `align` attr — center
      and right serialize as inline `text-align`, left canonicalizes to
      *nothing* (the default carries no declaration, and `dir="auto"` stays
      meaningful for RTL). Justify is refused: Outlook's Word engine mangles
      it. Toolbar group + Gmail keybindings (Mod-Shift-L/E/R); empty lines
      keep their alignment through the `<div><br></div>` serialization.
- [x] **Clear formatting** (`Mod-\`, toolbar): strips every mark from the
      selection; block structure (lists, quotes, alignment) is layout, not
      formatting, and stays. Note: not yet mirrored into the source pane —
      `createSourceMarks` mirrors mark extensions only; widening it to
      opt-in functional commands is a small follow-up if wanted.
- [x] **Font size/family** as a constrained set of email-safe stacks
      (Sans-serif `Arial, Helvetica, sans-serif`, Serif `Georgia, Times,
      serif`, Monospace `Courier, monospace`, System `system-ui, sans-serif`)
      — no free-form fonts. Both hang off the shared `textStyle` span as
      attributes (like `color`), so size + family + colour merge into one
      `style` string instead of nesting wrappers. Toolbar pickers offer only
      the curated set (the affordance is the enforcement, mirroring the colour
      palette); the picker's size list is the phone-safe subset (≥14px per the
      ledger) while the parser still accepts a hand-typed source-pane size, and
      the source pane is likewise free to type any font — anything outside the
      curated set simply drops on parse. Stacks are deliberately built from
      bare single-word identifiers + a generic fallback so they survive the
      CSSOM serialization round-trip byte-identically in both jsdom and Chrome
      (a quoted `"Courier New"` would diverge — the same trap the
      longhand/`rgb()` rule guards). Lint-clean (only the `font` *shorthand* is
      flagged, never the longhands); pinned by golden + round-trip tests.
- [x] **Dual-contrast color palette** (principle 9): replace the native
      arbitrary-hex color input with a curated swatch set whose every color
      reads against both white and near-black. Enforcement at the picker
      only — no color checking, rewriting, or nagging from the source pane.
- [ ] **Word/line counter placement** and the **`/send` slash command**
      (compose-level: the slash menu already aggregates extension items).

## Milestone 3 — The deliverability lint engine

Turn the linter from "is this valid HTML" into "will this render in Outlook".
This is where the source editor earns its seat.

- [x] **Client-support data module** (`client-support.ts`): a curated
      caniemail subset — CSS property entries with value/tag scoping
      (display:flex yes, display:block no; padding on div/p, not td) and
      client labels. Curation rule: only what we're confident about, phrased
      as what *actually happens*. Accuracy beats coverage; grows entry by
      entry.
- [x] **Style linting**: every inline declaration is checked against the
      data module, positioned on the exact declaration. The image hybrid
      (max-width paired with a width attribute) is exempt by design, and our
      own canonical output is lint-clean — pinned by test.
- [x] **Size budget**: the status strip grades the canonical HTML against
      Gmail's 102 KB clip (warning at 80%, error above), in UTF-8 bytes.
- [x] **Hover documentation**: tooltips name the client and the consequence
      ("max-width — Outlook (Windows): it sizes from the width attribute
      instead…") straight from the data module.
- [x] **Problems panel, first form**: a status strip under the panes —
      error/warning counts that jump the source pane to the first offender,
      plus the size gauge. A full listed panel can grow from the same
      diagnostics stream when needed.
- [x] **Autocomplete** for the email-safe vocabulary
      (`createHtmlAutocomplete`, same interaction contract as the slash
      menu): tags after `<` (accepting inserts the pair with the cursor
      between), the *currently open* tags after `</`, per-tag attributes
      (cursor lands inside the `=""`, already-present ones excluded), and
      safe style properties inside `style="…"` — never in prose, never in
      non-style attribute values. Context is derived from the document, not
      keystrokes, via the pure `completionContextAt`.

## Milestone 4 — Preview & proof

"Sure shot that our email renders" needs evidence, not confidence.

- [x] **Rendered preview pane** (`section[email-preview]`): the canonical
      HTML in a fully sandboxed iframe (no scripts, no same-origin) — a
      strictly read-only third projection of the same signal, opening at
      **320px phone width first** per the ledger, with a 600px toggle.
- [ ] **Client simulation modes**: today the preview applies a generic
      client surface (default typography on white); per-client resets
      (Gmail, Outlook Word-engine approximation) are still open. Honest
      label: simulation, not screenshot testing.
- [x] **Dark mode preview**: simulated Gmail-style forced inversion
      (`invert + hue-rotate`, images double-inverted back) — mid-tones
      survive, extremes flip, exactly the dual-contrast story made visible.
      Labeled as a simulation in the UI.
- [x] **Plain-text projection** (`emailPlainText`): blockquotes become `>`,
      lists `-`/`1.`, links keep URLs, images fall back to alt text —
      visible as the preview's "Text" tab, ready for multipart/alternative.
- [x] **Golden-file test suite**: exact canonical outputs pinned byte-for-
      byte plus round-trip fixpoint tests on foreign markup. Paid for itself
      immediately: it caught our styled link re-parsing its own
      `text-decoration` as an Underline mark — fixed by giving marks
      `emitDOM` (clean `<a>` in email output, pretty link in the editor
      view only).
- [ ] **Outlook conditional comments** (`<!--[if mso]>`): policy decided in
      M1 — if layout blocks need them, their serializer generates them and
      their parser ignores them; they are never document content.
      Marketing-grade table layouts remain a non-goal.

## Milestone 5 — Layout blocks, our way

MJML is the only well-known answer here, and we don't like it — it's clumsy,
and it's a foreign dialect. The bet instead: **if our responsive opinions are
strong enough, native blocks replace MJML entirely.** A `/columns` block is
just another schema extension that emits fluid, email-safe markup directly —
no compiler pass, no intermediary format, nothing the user (or the source
pane) can't see and edit.

- [x] **Slash-menu layout blocks** — four shipped blocks:
      **`/divider`** (a filled 1px bar, `width: 100%`, ledger-clean),
      **`/button`** (an atom serializing to a padded `inline-block` anchor —
      ≥44px touch target via padding, no `height`, no `border-radius`, so
      it's lint-clean; `display: inline-block` doubles as the parse
      discriminator that keeps a button distinct from a link), **`/table`**
      (see below), and **`/columns`** — the flagship. All appear in the slash
      menu automatically (the menu aggregates `slashItems` from the kit).
      Learned along the way (button): a block node rendered as an inline `<a>`
      can't hold editable content — contentEditable unwraps it on typing — so
      the button is an atom whose label/href are edited in the source pane
      (like image alt). An inline label editor is a polish follow-up.
- [x] **`/columns` — the MJML-killer (responsive layout, no media queries)**:
      `columns` > `column` nodes. Each column is an `inline-block` div with
      `width: 100%` capped by `max-width: container/n` and
      `box-sizing: border-box`; on a wide screen the caps let columns sit side
      by side, on a phone `width: 100%` wins and they **stack** — verified
      live (side-by-side at 640px, stacked at 320px). Outlook ignores
      `inline-block` and simply stacks too: the same graceful, phone-first
      result, no ghost tables needed for v1. `/columns` inserts 2 (each
      `max-width: 300px`), `3 columns` inserts 3 (`200px`); columns hold full
      block content (paragraphs, images, buttons, nested blocks). Parse is
      discriminated by the `display: inline-block` style (column) and by
      having inline-block child divs (container) — no data attributes, inline
      styles only. All longhand/fixed-px, so it's a byte-stable fixpoint in
      both engines. The lint's `max-width` warning is exempt when paired with
      `width: 100%` (the fluid pattern degrades gracefully in Outlook), so our
      own output stays clean. ArrowDown from a column's last block escapes to
      a paragraph below (like the table). Not yet: a UI to add/remove columns
      after insertion, and richer gutters beyond the 8px padding; Outlook
      ghost tables for true side-by-side there remain a deliberate non-goal.
- [x] **`/table` — constrained data table**: a real `<table role=
      "presentation">` (the most client-compatible layout) restricted to a
      plain rectangular grid — no colspan/rowspan, so the model is a clean 2D
      array. Nodes: `table` > `tableRow` > `tableCell` (`paragraph+`, so
      cells hold rich text). Working: slash/command insertion (cursor lands
      in cell 0,0), cell editing, **Tab/Shift-Tab navigation** (Tab past the
      last cell appends a row), and structural commands (`addRow/Column
      Before/After`, `deleteRow/Column`, `deleteTable`) that rebuild-and-
      replace the table node rather than juggle positions. Round-trips through
      the source pane, lint-clean, `<tbody>` fixpoint. Note: this is a *data*
      table (stays tabular, scrolls on a phone); the spongy stacking layout is
      the future `/columns`. **Deliberately kept simple** (an earlier
      Notion-style hover overlay — add/delete handles, padding steppers,
      pointer tracking — was tried and reverted; it was fiddly and got in the
      way): the only affordance is a **subtle editor-only grid shown while the
      cursor is editing inside the table**. A ProseMirror decoration tags the
      active table with `aee-table-editing`; global CSS reveals a
      transparent-reserved 1px cell border only then (no layout shift), *never*
      in the serialized email — the exported table is borderless with fixed,
      responsive padding (`8px 12px`). Structure is keyboard/command-driven:
      Tab/Shift-Tab navigation, and **ArrowDown from the last row escapes to a
      paragraph below** (created if the table is the last block) so you can
      always write underneath. The structural commands (`addColumnAt`,
      `deleteRowAt`, …) remain in the library for a future, calmer UI.
  - **Cells hold inline content** (`inline*`), not wrapped paragraphs: an
      empty cell is `<td></td>`, never `<td><div><br></div></td>`. The stray
      `<br>` made ProseMirror's parser grow a phantom cell on every round
      trip — a real corruption bug the text-cell tests had missed. Bonus:
      text marks (bold, links, colour) now work inside cells. Pinned by an
      empty-cell round-trip test.
- [ ] **Schema growth to hold them**: constrained table/section nodes with
      strict parse/serialize rules — the gate for this milestone, and it must
      not loosen the canonical guarantees for plain text emails.
- [x] **Round-trip stance**: holds for every shipped block (divider, button,
      table, columns) — each is canonical HTML, editable in the source pane,
      linted, re-parsed. No hidden state, no "locked" regions; the schema, as
      always, is law.
- [ ] **Template-ready, not templated.** We expect a handlebars-like dialect
      to emerge naturally once the blocks exist: placeholder nodes that
      survive the round trip and serialize as `{{name}}`-style tokens. We
      design the schema so nothing blocks that — and promise nothing more.

## The responsiveness ledger

Principle 8 dies in the details: each extension is built on a desktop, looks
fine on a desktop, and quietly breaks at 320px. This ledger exists because we
*will* forget. Rule of thumb for everything below: no media queries (they get
stripped), so every answer must be fluid and inline.

**Definition of done for any node extension: its JSDoc states what happens at
320px, and its serialize rules implement that answer.**

| Extension | The trap at 320px | Our fluid answer |
| --- | --- | --- |
| **Image** | Fixed pixel width overflows the screen; Outlook ignores `max-width` entirely | Hybrid sizing: `width` *attribute* for Outlook + `style="width:100%; max-width:<n>px; height:auto"` for everyone else |
| **Table / layout blocks (M5)** | Columns keep their desktop widths and force horizontal scroll | ✅ **Shipped (`/columns`)**: `inline-block` columns with `width:100%` capped by `max-width: container/n` + `box-sizing:border-box` — side by side when the caps fit, stacked when they don't. Outlook ignores `inline-block` and stacks too. Ghost tables for true Outlook side-by-side remain a non-goal for now. (Data `/table` is separate — it stays tabular.) |
| **Lists** | Default `padding-inline-start: 40px` per nesting level — two levels eat a third of the screen | Explicit small inline padding on `ul`/`ol`, tested nested |
| **Blockquote** | Nested reply chains accumulate margins until text is one word per line | Small fixed inline padding + border, no margin stacking; consider a visual nesting cap |
| **Headings** | Desktop-sized `h1` wraps into a wall at phone width | Conservative size scale that reads on both; line-height inline and proportional |
| **Paragraph / document width** | Full-width lines are unreadable on desktop, so someone will add a fixed container that then breaks phones | If we ever emit a wrapper, it is `max-width` + `width:100%` — the hybrid, never a fixed width |
| **Links / long text** | An unbroken URL or token wider than the viewport forces the whole email to scroll | `word-break`-friendly serialization for link text where possible; lint long unbroken strings |
| **Button block (M5)** | Padding-based fake buttons too small to tap | Touch target ≥ 44px via padding (never `height`), generous inline `padding` |
| **Font sizes** | Below ~13px, iOS auto-inflates text and reflows the layout | Minimum emitted font size ≥ 14px; the lint engine (M3) enforces it |
| **Horizontal rule** | Fixed pixel width | `width:100%`, done |

Two enforcement hooks so the ledger stays alive:

- [ ] **Lint rules from the ledger** (M3): fixed pixel widths without the
      hybrid pattern, sub-minimum font sizes, unbroken strings past a length
      budget — each row above that can be linted, is.
- [x] **320px preview default** (M4): the preview pane opens phone-width
      first. If it looks right narrow, desktop is almost free — never the
      other way around.

## Milestone 6 — Compose workflow

- [ ] `/send` wiring against a real transport (the payload is just the
      canonical signal + plain-text projection).
- [ ] Draft persistence (the canonical HTML *is* the draft format).
- [ ] Reply/forward: parse foreign inbound HTML through the schema —
      quoted-history blocks (`gmail_quote`-style) as a schema node.
- [ ] **`.eml` drop & HTML paste — one law.** The body always parses through
      the email schema, exactly like paste: full strip, no gentler pipeline,
      which doubles as sanitization (tracking pixels, remote CSS, script
      attempts die in the parse). The opinionation budget goes into
      *legibility of loss*, not leniency: an **import report** through the
      diagnostics channel ("14 elements outside the schema removed, 2 inline
      images mapped, 1 attachment ignored"). `cid:` images map into the
      image/attachment story; the `text/plain` part is the content when no
      HTML part exists; headers are discarded until compose fields return.
- [ ] Attachments surface.

## Non-goals (so we stay opinionated)

- **Not a drag-drop marketing builder.** No block canvas, no template
  gallery. This is a *compose* editor — but an ambitious one: the output is
  always responsive and phone-first (principle 8), and rich layout arrives
  through our own responsive schema blocks (M5), not through a page builder.
- **No MJML.** We tried it; it's clumsy, and it would make a foreign dialect
  the real source of truth. Being opinionated enough about fluid, responsive
  output is precisely what makes MJML unnecessary — that's the M5 bet.
- **No `<style>` blocks, no classes, no JS** in output. Inline styles only —
  everything else is stripped by enough clients to be a lie. This holds for
  responsiveness too: fluid layout, not media queries.
- **No template language — yet, but template-ready.** No promises before
  M1–M4 are solid; when it comes, it will be a handlebars-like dialect as a
  schema extension (M5), not a preprocessor bolted on top.
- **No free-form HTML passthrough.** If you need a tag the schema doesn't
  know, the answer is a new extension with parse/serialize/lint rules — not
  an escape hatch.

## Architecture notes for future us

- New capability = new extension. If it needs UI, it exposes state through a
  callback and the app renders it (see bubble/slash menus, diagnostics).
- Anything both panes must agree on lives in the **email schema**, never in
  either pane. The source pane consumes it via `createSourceMarks`-style
  round-trips.
- The library ships behavior, the app ships pixels. Token classes
  (`aee-tok-*`, `aee-lint-*`) are the styling contract.
- The app consumes the library from `dist/` — rebuild it (`ng build
  angular-email-editor`) or run `npm run watch`; if changes "don't arrive",
  clear `.angular/cache` (stale Vite prebundle).
- **Canonical serialized styles must use longhand properties and `rgb()`
  colours only — never CSS shorthands or hex.** Serialization round-trips
  through the CSSOM (`DOMSerializer` builds real elements, we read
  `innerHTML`), which re-serializes shorthands non-deterministically — and
  jsdom even *orders* them differently from Chrome, so a shorthand breaks
  canonical stability *and* makes tests disagree with the runtime. Longhands
  in written order and `rgb(r, g, b)` colours are stable everywhere. This
  gates every future block's styling (the M5 columns table especially). The
  golden suite exists to catch violations.
