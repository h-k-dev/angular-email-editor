import { EditorState, Plugin, PluginKey, TextSelection, AllSelection } from 'prosemirror-state';
import { FunctionalExtension, defineExtension } from '../extension'; // Adjust path if needed
import { selectionInsideMergeTag } from './nodes/merge-tag';
import { selectedImage } from './nodes/image';
import { selectedButton } from './nodes/button';
import { MenuScroll, watchMenuScroll } from './menu-scroll';

export interface BubbleMenuState {
  isOpen: boolean;
  boundingBox: DOMRect | null;
  /** What the menu is for: `'image'` when an image is the whole selection
      — clicked, or dragged over with nothing but whitespace beside it
      (`selectedImage`); `'button'` likewise for a button (`selectedButton`)
      — the box is then the node's own; `'text'` otherwise: a range with
      text in it, or with an image and a button both. A host shows each
      one's own tools. Absent while closed. */
  kind?: 'text' | 'image' | 'button';
}

export interface BubbleMenuOptions {
  /** How long a selection stands before the menu *opens* over it (150ms):
      a drag's or a Shift-Arrow's intermediate ranges never pop a menu. A
      menu that is already open answers a selection change at once — its
      kind, and with `anchor: 'selection'` its box — see the plugin view. */
  updateDelay?: number;
  /** Where the open menu stands as the selection changes under it:
      - `'first'` (the default): where it opened — over the selection as it
        stood then, an image's or a button's box when that was it. Shift-
        Arrow, a wider drag of the handles, a mark applied: the menu stays
        put, so the tools under the pointer never slide away from it. Only
        a scroll that `scroll: 'follow'` answers measures it again — the
        same range, where it now is.
      - `'selection'`: over the selection of the moment, reported afresh
        with every change.
      The menu's `kind` follows the selection either way. */
  anchor?: 'first' | 'selection';
  onStateChange: (state: BubbleMenuState) => void;
  shouldShow?: (state: EditorState) => boolean;
  /** What the menu does when the editor scrolls under it — closes, by
      default. See {@link MenuScroll}. */
  scroll?: MenuScroll;
  /** Where the focus may go and the menu stay open: the menu's own parts
      that are typed in — a field in it, a pane it opened (a colour's hex).
      A selector the focused element is inside of, or a function of that
      element. None by default: the menu shows while the editor has the
      focus, and goes once anything else takes it. */
  holdsFocus?: string | ((element: Element) => boolean);
}

// Inside a merge tag the menu stays away: the token is text, but formatting
// it is all-or-nothing and lives on the keyboard (Ctrl-B bolds the whole).
// An image alone is the other thing it opens for — clicked or dragged over —
// and a button alone. Exported, so a host's `shouldShow` can narrow it
// rather than restate it.
export const defaultBubbleShouldShow = (state: EditorState) =>
  !!selectedImage(state) ||
  !!selectedButton(state) ||
  (!state.selection.empty &&
    (state.selection instanceof TextSelection || state.selection instanceof AllSelection) &&
    !selectionInsideMergeTag(state));

export const createBubbleMenu = (options: BubbleMenuOptions): FunctionalExtension =>
  defineExtension({
    name: 'bubbleMenu',
    plugins: () => [
      new Plugin({
        key: new PluginKey('bubbleMenu'),
        view: (view) => {
          let showTimer: ReturnType<typeof setTimeout> | undefined;
          let mouseSelecting = false;
          let destroyed = false;
          let open = false;
          // Where the open menu stands (`anchor: 'first'`): the range or the
          // node it opened over, and the box measured there.
          let pinned: { from: number; to: number; node: boolean; box: DOMRect } | null = null;

          // Closed is said once: a caret moving through the text, or a press
          // elsewhere on the page, is no news to a host that already knows.
          const close = () => {
            if (!open) return;
            open = false;
            pinned = null;
            options.onStateChange({ isOpen: false, boundingBox: null });
          };

          // The focus in one of the menu's own parts (`holdsFocus`).
          const held = (): boolean => {
            const holds = options.holdsFocus;
            const active = view.dom.ownerDocument.activeElement;
            if (!holds || !active || active === view.dom.ownerDocument.body) return false;
            return typeof holds === 'string' ? !!active.closest(holds) : holds(active);
          };

          // Whether the menu may show: not mid-drag, the host's say-so, and
          // the editor focused — or one of the menu's own parts — or the
          // menu would pop up on a click elsewhere on the page.
          const canShow = () =>
            !destroyed &&
            !mouseSelecting &&
            (options.shouldShow || defaultBubbleShouldShow)(view.state) &&
            (view.hasFocus() || held());

          // The box of a range: from its start to its end, over every line it
          // takes — the virtual DOMRect the host's overlay anchors to.
          const rangeBox = (from: number, to: number): DOMRect => {
            const start = view.coordsAtPos(from);
            const end = view.coordsAtPos(to, -1);
            const top = Math.min(start.top, end.top);
            const bottom = Math.max(start.bottom, end.bottom);
            const left = Math.min(start.left, end.left);
            const right = Math.max(start.right, end.right);
            return {
              top,
              bottom,
              left,
              right,
              width: right - left,
              height: bottom - top,
              x: left,
              y: top,
              toJSON: () => '',
            } as DOMRect;
          };

          // The box of a node: its own element's, while it has one.
          const nodeBox = (pos: number): DOMRect | null => {
            const dom = view.nodeDOM(pos) as HTMLElement | null;
            return dom && typeof dom.getBoundingClientRect === 'function'
              ? dom.getBoundingClientRect()
              : null;
          };

          // Reports the menu open over the current selection — standing
          // where it opened (`anchor: 'first'`), or over the selection of
          // the moment. `remeasure`: the pinned place has moved on screen
          // (a scroll), so its box is measured again.
          const show = (remeasure = false) => {
            // Asked again once the delay is over: in between, the host may
            // have opened something of its own there (a click on a button
            // opens its link editor) that its `shouldShow` now says no to.
            if (!canShow()) return close();
            // An image alone, or a button: the menu is for the node, and
            // stands over the node itself — while it has an element to
            // stand over; text otherwise.
            const image = selectedImage(view.state);
            const button = image ? null : selectedButton(view.state);
            const node = image ?? button;
            const box = node ? nodeBox(node.pos) : null;
            const kind = box ? (image ? 'image' : 'button') : 'text';

            if (pinned && (options.anchor ?? 'first') === 'first') {
              if (remeasure) {
                // The same place, where it now is — clamped, in case the
                // document shrank under it since.
                const size = view.state.doc.content.size;
                const from = Math.min(pinned.from, size);
                pinned.box =
                  (pinned.node ? nodeBox(from) : rangeBox(from, Math.min(pinned.to, size))) ??
                  pinned.box;
              }
              options.onStateChange({ isOpen: true, boundingBox: pinned.box, kind });
              return;
            }

            const { from, to } = view.state.selection;
            pinned = box
              ? { from: node!.pos, to: node!.pos, node: true, box }
              : { from, to, node: false, box: rangeBox(from, to) };
            open = true;
            options.onStateChange({ isOpen: true, boundingBox: pinned.box, kind });
          };

          const refresh = () => {
            if (destroyed) return;
            clearTimeout(showTimer);

            if (!canShow()) {
              close();
              return;
            }

            // Open already: the menu answers the selection *now* — its kind
            // (and, following the selection, its box) changes in the same
            // transaction the selection did, so what a host renders from the
            // state and what it reads live from the editor (an image's alt,
            // an action's enabled) never disagree. Delayed, the image's menu
            // showed the alt of an image no longer selected alone — empty —
            // and its image tools disabled, for the delay, before the text's
            // menu replaced it. The delay is for *opening*: a range passing
            // through, a drag's intermediate selections, never pop a menu of
            // their own. Pinned (`anchor: 'first'`), the box stays where the
            // menu opened.
            if (open) return show();
            showTimer = setTimeout(show, options.updateDelay ?? 150);
          };

          // 1. Mouse Tracking: Don't show the menu while the user is actively dragging a selection.
          // Only a mousedown that begins inside the editor starts a text-selection drag. A mousedown
          // elsewhere — above all on the bubble menu itself, which renders in a CDK overlay outside
          // view.dom — must not count, or every button press would hide the menu and tear down the
          // overlay around the very click meant to run the command.
          const onWindowMousedown = (event: MouseEvent) => {
            if (!view.dom.contains(event.target as Node)) return;
            mouseSelecting = true;
            refresh();
          };
          // Only the release of a drag that began in the editor ends one.
          const onMouseup = () => {
            if (!mouseSelecting) return;
            mouseSelecting = false;
            refresh();
          };
          window.addEventListener('mousedown', onWindowMousedown);
          window.addEventListener('mouseup', onMouseup);

          // 2. Focus Tracking: Clean up nicely when blurring
          const onBlur = () => requestAnimationFrame(refresh);
          const onFocus = () => refresh();
          view.dom.addEventListener('blur', onBlur);
          view.dom.addEventListener('focus', onFocus);
          // The focus leaving one of the menu's own parts — for the page, not
          // the editor — is a blur of the editor's too.
          const onFocusout = (event: FocusEvent) => {
            if (open && !view.dom.contains(event.target as Node)) onBlur();
          };
          if (options.holdsFocus) view.dom.ownerDocument.addEventListener('focusout', onFocusout);

          // 3. Scroll: the box is viewport coordinates, stale once the
          // editor scrolls under the menu — closed by default, see
          // `MenuScroll`. Following re-reports the box of an open menu.
          const stopScrollWatch = watchMenuScroll(view, options.scroll, {
            close,
            refresh: () => {
              if (open) show(true);
            },
          });

          return {
            update(view, prevState) {
              const selectionChanged = !prevState || !prevState.selection.eq(view.state.selection);
              const docChanged = !prevState || !prevState.doc.eq(view.state.doc);

              if (selectionChanged || docChanged) {
                refresh();
              }
            },
            destroy() {
              destroyed = true;
              clearTimeout(showTimer);

              // Cleanup listeners
              window.removeEventListener('mousedown', onWindowMousedown);
              window.removeEventListener('mouseup', onMouseup);
              view.dom.removeEventListener('blur', onBlur);
              view.dom.removeEventListener('focus', onFocus);
              view.dom.ownerDocument.removeEventListener('focusout', onFocusout);
              stopScrollWatch();

              close();
            },
          };
        },
      }),
    ],
  });
