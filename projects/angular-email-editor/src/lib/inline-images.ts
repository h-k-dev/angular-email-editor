import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { InlineImageStore, rewriteInlineImageSources } from './prose-mirror/extensions/inline-images';

/** A blob as a data URL — what the preview's opaque-origin sandbox can load. */
function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * The inline image registry as an Angular service — the wiring around the
 * framework-free {@link InlineImageStore}: one per composer (provide it on
 * the composer component, never in root — two composers must not share
 * parts), a signal that bumps on every change so the preview and the host
 * can react, data URLs for the preview (a sandboxed, opaque-origin frame
 * cannot load the editor's blob URLs), and every URL revoked with the
 * composer. The editor pane hands it to `createInlineImages`; the host feeds
 * it an import's parts and reads the referenced ones for a draft.
 */
@Injectable()
export class InlineImages extends InlineImageStore {
  readonly #version = signal(0);
  readonly #dataUrls = new Map<string, string>();

  /** Bumps on every registered part (and again once its data URL is ready);
      read it in a `computed`/`effect` to re-derive from the registry. */
  readonly version = this.#version.asReadonly();

  constructor() {
    super();
    this.subscribe(() => this.#version.update((v) => v + 1));
    inject(DestroyRef).onDestroy(() => this.revokeAll());
  }

  override add(blob: Blob, cid?: string): string {
    const id = super.add(blob, cid);
    void toDataUrl(blob).then((url) => {
      if (this.blob(id) !== blob) return; // replaced meanwhile
      this.#dataUrls.set(id, url);
      this.#version.update((v) => v + 1);
    });
    return id;
  }

  override revokeAll(): void {
    this.#dataUrls.clear();
    super.revokeAll();
  }

  /** The part as a data URL, once read; undefined until then. */
  dataUrl(cid: string): string | undefined {
    return this.#dataUrls.get(cid);
  }

  /** The preview's projection of the canonical HTML: every `cid:` source the
      registry holds becomes a data URL. Reads {@link version}, so a
      `computed` over it re-runs when a part arrives. */
  previewHtml(html: string): string {
    this.version();
    return rewriteInlineImageSources(html, (cid) => this.dataUrl(cid));
  }
}
