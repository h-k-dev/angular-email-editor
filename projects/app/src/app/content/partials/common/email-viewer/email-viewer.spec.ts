import { TestBed } from '@angular/core/testing';

import { EmailViewer } from './email-viewer';

// `load` waits for every picture: one that never answers (a tracking pixel)
// would leave the email in the frame's default 150px for good.
describe('EmailViewer, with a picture that never loads', () => {
  // By id, as the browser's: Angular's scheduler asks for frames (and
  // cancels them) too.
  let frames: Map<number, FrameRequestCallback>;
  let lastFrame = 0;
  const nextFrame = () => {
    const due = [...frames.values()];
    frames.clear();
    due.forEach((run) => run(0));
  };

  // The frame is looked at only while it is in sight.
  let sight: (inSight: boolean) => void;

  /** The frame's document, as far as `fit` reads it. */
  const documentAt = (readyState: DocumentReadyState) => {
    const root = document.createElement('html');
    root.getBoundingClientRect = () => ({ height: 1682 }) as DOMRect;
    return { readyState, URL: 'about:srcdoc', documentElement: root };
  };
  // What `fit` leaves on the document tells it ran.
  const fitted = (doc: ReturnType<typeof documentAt>) =>
    doc.documentElement.style.overflow === 'hidden';

  beforeEach(() => {
    frames = new Map();
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      frames.set(++lastFrame, run);
      return lastFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(tell: (entries: { isIntersecting: boolean }[]) => void) {
          sight = (isIntersecting) => tell([{ isIntersecting }]);
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const hanging = async () => {
    const fixture = TestBed.createComponent(EmailViewer);
    fixture.componentRef.setInput('html', '<p>Hallo</p><img src="https://tracker.example/pixel">');
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
  };

  it('fits the email once it is parsed, without its load', async () => {
    const iframe = await hanging();
    let doc = documentAt('loading');
    Object.defineProperty(iframe, 'contentDocument', { get: () => doc });

    sight(true);
    nextFrame();
    expect(fitted(doc)).toBe(false);

    doc = documentAt('interactive');
    nextFrame();
    expect(fitted(doc)).toBe(true);

    // And looks no further: the next document is `document()`'s to bring.
    doc = documentAt('interactive');
    nextFrame();
    expect(fitted(doc)).toBe(false);
  });

  it('does not look at a frame out of sight', async () => {
    const iframe = await hanging();
    const doc = documentAt('interactive');
    Object.defineProperty(iframe, 'contentDocument', { get: () => doc });

    nextFrame();
    expect(fitted(doc)).toBe(false);

    sight(true);
    sight(false);
    nextFrame();
    expect(fitted(doc)).toBe(false);

    sight(true);
    nextFrame();
    expect(fitted(doc)).toBe(true);
  });
});
