import { TestBed } from '@angular/core/testing';
import { simulatedDuration } from 'angular-email-editor';
import { ATTACHMENT_UPLOAD_OPTIONS, AttachmentUploads } from './attachment-uploads';

const PREPROCESS = 100;
const LINGER = 100;
const CONCURRENCY = 2;
/** A line where a spec file takes its size over the speed and nothing
    else: 10 KB/s, so 1 KB is 100 ms, floor and ceiling out of the way. */
const LINE = {
  bytesPerSecond: 1024 * 10,
  minDuration: 0,
  maxDuration: 60_000,
  fallbackDuration: 0,
};
const duration = (size: number) => simulatedDuration(size, LINE);

describe('AttachmentUploads', () => {
  let service: AttachmentUploads;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ATTACHMENT_UPLOAD_OPTIONS,
          useValue: {
            tick: 10,
            // Pinned to PREPROCESS for every size: floor and ceiling meet.
            preprocess: {
              bytesPerSecond: 1,
              minDuration: PREPROCESS,
              maxDuration: PREPROCESS,
              fallbackDuration: PREPROCESS,
            },
            concurrency: CONCURRENCY,
            linger: LINGER,
            line: LINE,
          },
        },
      ],
    });
    service = TestBed.inject(AttachmentUploads);
  });

  afterEach(() => vi.useRealTimers());

  it('hands back a reference with no id and walks the transfer through its stages', async () => {
    const ref = service.start({ name: 'report.pdf', type: 'application/pdf', size: 2048 });
    expect(ref).toEqual({
      key: 'upload-1',
      id: null,
      name: 'report.pdf',
      type: 'application/pdf',
      size: 2048,
    });
    const status = service.status(ref.key);
    const progress = service.progress(ref.key);

    // Preprocessing: busy, nothing to count.
    expect(status()).toBe('preprocessing');
    expect(progress()).toBeNull();
    await vi.advanceTimersByTimeAsync(PREPROCESS / 2);
    expect(status()).toBe('preprocessing');
    expect(progress()).toBeNull();

    // A connection is free, so uploading follows at once: the bytes move,
    // and the number appears.
    const total = duration(2048);
    await vi.advanceTimersByTimeAsync(PREPROCESS / 2 + total / 2);
    expect(status()).toBe('uploading');
    expect(progress()).toBeGreaterThan(0.3);
    expect(progress()).toBeLessThan(0.7);

    let id: string | undefined;
    void service.whenDone(ref.key).then((value) => (id = value));
    await vi.advanceTimersByTimeAsync(total / 2);
    expect(progress()).toBe(1);

    // Full, and still uploading: the bar gets its moment.
    await vi.advanceTimersByTimeAsync(LINGER / 2);
    expect(status()).toBe('uploading');
    expect(id).toBeUndefined();

    // Complete, and the id lands.
    await vi.advanceTimersByTimeAsync(LINGER);
    expect(status()).toBe('complete');
    expect(id).toBe('att_1');
  });

  it('preprocesses every file at once, then uploads over its connections in order', async () => {
    const [a, b, c] = [1, 2, 3].map((n) => service.start({ name: `${n}.pdf`, size: 1024 }));
    const status = (ref: { key: string }) => service.status(ref.key)();

    expect([a, b, c].map(status)).toEqual(['preprocessing', 'preprocessing', 'preprocessing']);

    // Two connections: the first two upload, the third waits.
    await vi.advanceTimersByTimeAsync(PREPROCESS);
    expect([a, b, c].map(status)).toEqual(['uploading', 'uploading', 'queued']);
    expect(service.progress(c.key)()).toBeNull();

    // A connection frees, and the one waiting takes it.
    await vi.advanceTimersByTimeAsync(duration(1024) + LINGER + 10);
    expect([a, b, c].map(status)).toEqual(['complete', 'complete', 'uploading']);

    await vi.advanceTimersByTimeAsync(duration(1024) + LINGER + 10);
    expect(status(c)).toBe('complete');
  });

  it('paces a transfer by its size over the line, so sizes tell apart', async () => {
    const small = service.start({ name: 'small.pdf', size: 1024 });
    const large = service.start({ name: 'large.pdf', size: 4096 });
    await vi.advanceTimersByTimeAsync(PREPROCESS + duration(1024) / 2);

    expect(service.progress(small.key)()).toBeCloseTo(0.5, 1);
    expect(service.progress(large.key)()).toBeCloseTo(0.125, 1);
  });

  it('paces preprocessing by size too, over its own line', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ATTACHMENT_UPLOAD_OPTIONS,
          useValue: { tick: 10, preprocess: LINE, concurrency: 2, linger: LINGER, line: LINE },
        },
      ],
    });
    const paced = TestBed.inject(AttachmentUploads);
    const small = paced.start({ name: 'small.pdf', size: 1024 });
    const large = paced.start({ name: 'large.pdf', size: 4096 });

    await vi.advanceTimersByTimeAsync(duration(1024) + 10);
    expect(paced.status(small.key)()).toBe('uploading');
    expect(paced.status(large.key)()).toBe('preprocessing');

    await vi.advanceTimersByTimeAsync(duration(4096) - duration(1024));
    expect(paced.status(large.key)()).toBe('uploading');
  });

  it('keeps each transfer apart, with an unknown key reading as nothing', () => {
    const a = service.start({ name: 'a.pdf', size: 1024 });
    const b = service.start({ name: 'b.pdf' });
    expect(a.key).not.toBe(b.key);
    expect(service.status('never')()).toBeNull();
    expect(service.progress('never')()).toBeNull();
  });

  it('a cancelled transfer stops and never settles', async () => {
    const ref = service.start({ name: 'a.pdf', size: 1024 });
    let settled = false;
    void service.whenDone(ref.key).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(PREPROCESS + 50);
    service.cancel(ref.key);
    await vi.advanceTimersByTimeAsync(duration(1024) * 2 + LINGER);
    expect(settled).toBe(false);
    expect(service.status(ref.key)()).toBeNull();
    expect(service.progress(ref.key)()).toBeNull();
  });

  it('a cancelled waiting transfer leaves the line, and a cancelled upload frees its connection', async () => {
    const [a, b, c, d] = [1, 2, 3, 4].map((n) => service.start({ name: `${n}.pdf`, size: 1024 }));
    const status = (ref: { key: string }) => service.status(ref.key)();
    await vi.advanceTimersByTimeAsync(PREPROCESS);
    expect([a, b, c, d].map(status)).toEqual(['uploading', 'uploading', 'queued', 'queued']);

    // Out of the line: nobody moves, no connection was taken.
    service.cancel(c.key);
    await vi.advanceTimersByTimeAsync(10);
    expect([a, b, d].map(status)).toEqual(['uploading', 'uploading', 'queued']);

    // Off a connection: the next in line takes it at once.
    service.cancel(a.key);
    await vi.advanceTimersByTimeAsync(10);
    expect([b, d].map(status)).toEqual(['uploading', 'uploading']);
    expect(status(a)).toBeNull();
  });
});
