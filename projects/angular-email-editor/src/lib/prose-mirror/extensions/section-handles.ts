import { Node } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, Selection } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';
import { layoutInteractive } from './layout-interaction';
import { isBandRow } from './nodes/page-row';
import { findBandContext } from './nodes/section';

/** The band whose grip was pressed, and where the grip is on screen — what
    the host's menu anchors to. */
export interface SectionHandleTarget {
  kind: 'section';
  /** The band's position in the document. Read it again before acting: the
      press put the caret in the band, so the caret-relative section
      commands (`setSectionBackground`, `setSectionImage`, `removeSection`)
      need no position. */
  sectionPos: number;
  /** The grip's own rect. */
  boundingBox: DOMRect;
}

export interface SectionHandlesOptions {
  /** A band's grip was pressed, or the grip went away under an open menu
      (`null`) — the layout switched static, the band was removed. */
  onOpen: (target: SectionHandleTarget | null) => void;
  /** What the grip says to assistive tech, translated by the host. */
  label?: () => string;
}

const sectionHandlesKey = new PluginKey('sectionHandles');

/**
 * A band's grip — a table column's (table-handles.ts), on a section: a pill
 * centred on the band's top edge, which opens the host's section menu — its
 * colour, the image behind it, taking it away. A band has one width (the
 * email's), so one grip in its middle says which band it is about, the way
 * a column's grip sits over its column.
 *
 * Every band has one, revealed as a column's is: by the pointer over the
 * band (the host's `:hover` rule), and always on the band the caret is in
 * (`data-caret`). Pressing one puts the caret in its band — measured first:
 * the caret moving re-renders the grips — so the menu's actions are the
 * ordinary caret-relative section commands.
 *
 * A page of rows' band — a row given a fill or an image (`/section`,
 * `findBandContext`) — has the same grip, on the row's top edge, and the
 * same menu; its Remove makes it a plain row again. A plain row has none.
 *
 * Shown only while sections are interactive (`layoutInteraction`): writing
 * in a template whose layout is settled, a band takes no gesture. The grip
 * is a widget at the start of the band's content, placed against the band
 * itself: the host makes the band (`.aee-section`, `.aee-page-row`) the
 * positioned box.
 */
export const createSectionHandles = (options: SectionHandlesOptions): FunctionalExtension => {
  const label = options.label ?? (() => 'Section options');

  const sectionGrip = (
    view: EditorView,
    getPos: () => number | undefined,
    caret: boolean,
  ): HTMLElement => {
    const el = document.createElement('span');
    // A column grip's face, on the band's top edge (the host's
    // `.aee-grip--column`).
    el.className = 'aee-grip aee-grip--column aee-grip--section';
    if (caret) el.dataset['caret'] = '';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', label());
    el.setAttribute('title', label());
    el.setAttribute('aria-haspopup', 'menu');
    el.setAttribute('aria-expanded', 'false');
    el.contentEditable = 'false';
    el.appendChild(document.createElement('i'));
    // Not the editor's press: it would put the caret where the pointer is.
    el.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    el.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const at = getPos();
      if (at === undefined) return;
      const sectionPos = at - 1;
      // Measured before the caret moves: moving it re-renders the grips,
      // and a detached grip measures nothing.
      const boundingBox = el.getBoundingClientRect();
      const { state } = view;
      if (findBandContext(state)?.pos !== sectionPos) {
        view.dispatch(
          state.tr.setSelection(Selection.near(state.doc.resolve(sectionPos + 1))),
        );
      }
      // The band's grip as it stands now — the caret's.
      const grip =
        view.dom.querySelector<HTMLElement>('.aee-grip--section[data-caret]') ?? el;
      grip.setAttribute('aria-expanded', 'true');
      // The menu takes the focus and hands it back to the text when it is
      // done: that return is the grip's cue to fold.
      view.dom.addEventListener('focus', () => grip.setAttribute('aria-expanded', 'false'), {
        once: true,
      });
      options.onOpen({ kind: 'section', sectionPos, boundingBox });
    });
    return el;
  };

  return defineExtension({
    name: 'sectionHandles',
    plugins: () => [
      new Plugin({
        key: sectionHandlesKey,
        props: {
          decorations: (state) => {
            if (!layoutInteractive(state, 'section')) return null;
            const caret = findBandContext(state)?.pos;
            const grips = bands(state).map((pos) =>
              Decoration.widget(
                pos + 1,
                (view, getPos) => sectionGrip(view, getPos, pos === caret),
                {
                  key: `section-grip-${pos}-${pos === caret ? 'caret' : 'hover'}`,
                  side: -1,
                  ignoreSelection: true,
                },
              ),
            );
            return grips.length ? DecorationSet.create(state.doc, grips) : null;
          },
        },
        view: (view) => {
          let interactive = layoutInteractive(view.state, 'section');
          let pos = findBandContext(view.state)?.pos;
          return {
            update: () => {
              // Switched static, or the band gone, under an open menu: the
              // grip it hangs from is gone.
              const now = layoutInteractive(view.state, 'section');
              const at = findBandContext(view.state)?.pos;
              if ((interactive && !now) || (pos !== undefined && at === undefined)) {
                options.onOpen(null);
              }
              interactive = now;
              pos = at;
            },
          };
        },
      }),
    ],
  });
};

/** Where every band of the document is: each section, and each page row
    that is the page's band. */
function bands(state: EditorState): number[] {
  const found: number[] = [];
  state.doc.descendants((node: Node, pos: number) => {
    if (node.isTextblock || node.isAtom) return false;
    if (node.type.name === 'section' || isBandRow(node)) found.push(pos);
    return true;
  });
  return found;
}
