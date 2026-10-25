import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import {
  Editor,
  SuggestionCommandItem,
  SuggestionItem,
  SuggestionMenuState,
  createEditor,
  createSuggestionMenu,
  richTextExtensions,
} from '@h-k-dev/angular-email-editor';
import {
  SuggestionMenu,
  SuggestionMenuItem,
  SuggestionMenuSection,
} from '@h-k-dev/angular-email-editor/suggestion-menu';

import { Playground, PlaygroundAction, PlaygroundSubject, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** The `{{` source's catalogue: paths it matches by itself. */
const TOKEN_PATHS = ['first_name', 'last_name', 'email', 'company', 'unsubscribe_url', 'order.id'];

/**
 * The menu pair on a small live editor — the pair needs one: the
 * extension finds the trigger, filters, pages and places; the pair
 * renders the state. `/` has static rows in two sections and a group that
 * opens a second level; `{{` asks a source that answers late (or fails),
 * to see the loading, stale and error states. The value panel is the
 * state, short.
 */
@Component({
  selector: 'suggestion-menu-playground',
  imports: [
    PlaygroundFrame,
    PlaygroundSubject,
    SuggestionMenu,
    SuggestionMenuItem,
    SuggestionMenuSection,
    MatIcon,
  ],
  templateUrl: './suggestion-menu-playground.html',
  styleUrls: ['../playground/playground-stage.scss', './suggestion-menu-playground.scss'],
  providers: [Playground],
})
export class SuggestionMenuPlayground {
  protected readonly playground = inject(Playground);

  readonly placement = signal<'caret' | 'docked'>('caret');
  readonly announceDelay = signal(400);
  readonly label = signal('Suggestions');
  readonly latency = signal(600);
  readonly fails = signal(false);

  protected readonly state = signal<SuggestionMenuState | undefined>(undefined);

  /** The state, short — no functions, the rows by id. */
  protected readonly summary = computed(() => {
    const state = this.state();
    if (!state) return null;
    return {
      open: state.open,
      trigger: state.trigger,
      label: state.label,
      level: state.level,
      parent: state.parent?.id ?? null,
      query: state.query,
      activeIndex: state.activeIndex,
      items: state.items.map((item) => item.id),
      loading: state.loading,
      stale: state.stale,
      loadingMore: state.loadingMore,
      hasMore: state.hasMore,
      error: state.error ? String(state.error) : null,
    };
  });

  protected readonly knobs = [
    knob.choice('placement', this.placement, ['caret', 'docked']),
    knob.number('announceDelay (ms)', this.announceDelay, { min: 0, step: 100 }),
    knob.text('label', this.label),
    knob.number('{{ source latency (ms)', this.latency, { min: 0, step: 100 }),
    knob.boolean('{{ source fails', this.fails),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: "type '/'", run: () => this.#type('/') },
    { name: "type '{{'", run: () => this.#type('{{') },
    { name: 'state.dismiss()', run: () => this.state()?.dismiss() },
  ];

  protected readonly menu = viewChild.required('menu', { read: ElementRef });
  protected readonly host = viewChild.required<ElementRef<HTMLElement>>('editor');
  #editor: Editor | undefined;

  readonly #tokens = TOKEN_PATHS.map((path) =>
    this.#writes(`token-${path}`, path.replace(/[._]/g, ' '), `{{ ${path} }}`, { detail: path }),
  );

  constructor() {
    const items: SuggestionItem[] = [
      this.#writes('hello', 'Say hello', 'Hello! ', { icon: 'waving_hand', section: 'text' }),
      this.#writes('sign', 'Sign off', 'Best regards, ', { icon: 'draw', section: 'text' }),
      this.#writes('date', 'Today’s date', `${new Date().toDateString()} `, {
        icon: 'today',
        section: 'insert',
        keywords: ['time', 'now'],
      }),
      {
        id: 'emoji',
        title: 'Emoji',
        icon: 'mood',
        section: 'insert',
        placeholder: 'Search emoji…',
        children: [
          this.#writes('smile', 'Smile', '🙂 '),
          this.#writes('party', 'Party', '🎉 '),
          this.#writes('thumbs', 'Thumbs up', '👍 '),
          this.#writes('heart', 'Heart', '❤️ '),
        ],
      },
    ];

    afterNextRender(() => {
      this.#editor = createEditor({
        parent: this.host().nativeElement,
        extensions: [
          ...richTextExtensions,
          createSuggestionMenu({
            element: this.menu().nativeElement,
            triggers: [
              {
                trigger: '/',
                label: 'Insert',
                placeholder: 'Type to filter…',
                items,
                sections: { text: 'Text', insert: 'Insert' },
              },
              {
                trigger: '{{',
                label: 'Tokens',
                query: /^ ?[\w.]*$/,
                source: (request) => this.#ask(request.query, request.signal),
              },
            ],
            onChange: (state) => this.#changed(state),
          }),
        ],
      });
    });
    inject(DestroyRef).onDestroy(() => this.#editor?.destroy());
  }

  /** A row that writes its words where the trigger was — and its pick to
      the log. */
  #writes(
    id: string,
    title: string,
    text: string,
    extra: Partial<SuggestionCommandItem> = {},
  ): SuggestionCommandItem {
    return {
      id,
      title,
      command: (state, dispatch) => {
        if (dispatch) {
          this.playground.log('pick', id);
          dispatch(state.tr.insertText(text));
        }
        return true;
      },
      ...extra,
    };
  }

  /** The `{{` source: late by the knob, failing by the knob. */
  #ask(query: string, abort: AbortSignal): Promise<SuggestionCommandItem[]> {
    const wanted = query.trim().toLowerCase();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.fails()) reject(new Error('The source failed (knob)'));
        else resolve(this.#tokens.filter((token) => token.detail?.includes(wanted)));
      }, this.latency());
      abort.addEventListener('abort', () => clearTimeout(timer));
    });
  }

  /** The state in, and what changed about it to the log — not every arrow
      press: opening, closing, a level, an error. */
  #changed(state: SuggestionMenuState): void {
    const before = this.state();
    this.state.set(state);
    if (state.open !== before?.open) {
      this.playground.log(state.open ? 'open' : 'close', state.trigger);
    } else if (state.level !== before?.level) {
      this.playground.log(`level ${state.level}`, state.parent?.id ?? null);
    }
    if (state.error && state.error !== before?.error) this.playground.log('error', state.error);
  }

  /** Puts the trigger at the caret, as typing would — the menu opens off it. */
  #type(trigger: string): void {
    const view = this.#editor?.view;
    if (!view) return;
    view.focus();
    const { from } = view.state.selection;
    const before = view.state.doc.textBetween(Math.max(0, from - 1), from);
    view.dispatch(view.state.tr.insertText(before && before !== ' ' ? ` ${trigger}` : trigger));
  }
}
