import { TestBed } from '@angular/core/testing';
import { BlobStore } from './blob-store';

describe('BlobStore', () => {
  it('degrades where IndexedDB is missing: reads find nothing, writes report false', async () => {
    // The test DOM has no IndexedDB — the same as a browser that refuses it.
    expect(window.indexedDB).toBeUndefined();
    TestBed.configureTestingModule({});
    const store = TestBed.inject(BlobStore);

    expect(await store.put([['a', new Blob(['a'])]])).toBe(false);
    expect(await store.get('a')).toBeUndefined();
    expect(await store.keys()).toEqual([]);
    expect(await store.delete(['a'])).toBe(false);
    expect(await store.clear()).toBe(false);
    // Nothing to do is done.
    expect(await store.put([])).toBe(true);
  });
});
