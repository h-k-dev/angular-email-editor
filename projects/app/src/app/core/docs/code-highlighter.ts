import { Service } from '@angular/core';
import type { HighlighterCore, LanguageInput } from 'shiki/core';

/** The languages a reference page shows code in. */
export type CodeLanguage = 'ts' | 'html' | 'css' | 'scss' | 'bash';

/** One coloured run of a line: its text, and its colour for either scheme
    (`light-dark(…)`, resolved by the element's `color-scheme`). */
export interface CodeToken {
  readonly content: string;
  readonly color: string | null;
}

export type CodeLine = readonly CodeToken[];

/** Each grammar a chunk of its own, fetched the first time a block in that
    language shows. HTML brings CSS and JavaScript with it (its embedded
    style and script). */
const GRAMMARS: Record<CodeLanguage, LanguageInput> = {
  ts: () => import('shiki/langs/typescript.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  bash: () => import('shiki/langs/shellscript.mjs'),
};

const SHIKI_NAMES: Record<CodeLanguage, string> = {
  ts: 'typescript',
  html: 'html',
  css: 'css',
  scss: 'scss',
  bash: 'shellscript',
};

/**
 * Code coloured the way GitHub colours it — Shiki, with GitHub's light and
 * dark themes as one `light-dark()` colour per token, so the scheme the
 * page is in picks.
 *
 * Small on purpose: Shiki's core, its JavaScript regex engine (no WASM)
 * and each grammar load the first time a code block asks — the reference
 * pages pay for it, nothing else does.
 *
 * Tokens, not HTML: a template renders them as text, so nothing is bound
 * as `innerHTML` and nothing bypasses the sanitizer.
 */
@Service()
export class CodeHighlighter {
  #highlighter: Promise<HighlighterCore> | null = null;
  readonly #loaded = new Map<CodeLanguage, Promise<void>>();

  /** `code` as lines of coloured tokens. */
  async tokens(code: string, language: CodeLanguage): Promise<readonly CodeLine[]> {
    const highlighter = await this.#core();
    await this.#language(highlighter, language);
    const { tokens } = highlighter.codeToTokens(code, {
      lang: SHIKI_NAMES[language],
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: 'light-dark()',
    });
    return tokens.map((line) =>
      line.map((token) => ({ content: token.content, color: token.htmlStyle?.['color'] ?? null })),
    );
  }

  #core(): Promise<HighlighterCore> {
    this.#highlighter ??= (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/javascript'),
      ]);
      return createHighlighterCore({
        themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
    })();
    return this.#highlighter;
  }

  #language(highlighter: HighlighterCore, language: CodeLanguage): Promise<void> {
    let loaded = this.#loaded.get(language);
    if (!loaded) {
      loaded = highlighter.loadLanguage(GRAMMARS[language]);
      this.#loaded.set(language, loaded);
    }
    return loaded;
  }
}
