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
    return {
      readyState,
      URL: 'about:srcdoc',
      documentElement: root,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
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

// A frame's document keeps its keys: said again on the frame, the page's
// shortcuts work while the email has the focus.
describe('EmailViewer, with a key pressed in the email', () => {
  it('says it again on the frame', async () => {
    const fixture = TestBed.createComponent(EmailViewer);
    fixture.componentRef.setInput('html', '<p>Hallo</p>');
    await fixture.whenStable();
    const iframe = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    // jsdom loads no `srcdoc`: a document of its own, drawn as far as `load`.
    const email = document.implementation.createHTMLDocument();
    Object.defineProperty(iframe, 'contentDocument', { get: () => email });
    iframe.dispatchEvent(new Event('load'));

    const heard: KeyboardEvent[] = [];
    iframe.addEventListener('keydown', (event) => {
      heard.push(event);
      event.preventDefault();
    });
    const pressed = new KeyboardEvent('keydown', {
      key: 'r',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    // Fitted again on its `load`, after it was fitted parsed: still once.
    iframe.dispatchEvent(new Event('load'));
    email.body.dispatchEvent(pressed);

    expect(heard.map(({ key, shiftKey }) => ({ key, shiftKey }))).toEqual([
      { key: 'r', shiftKey: true },
    ]);
    expect(pressed.defaultPrevented).toBe(true);
  });
});

// A fold in the email (Dawn's ⋯ over a quoted history) opens onto a mail
// that may be wider than the answer over it.
describe('EmailViewer, with a fold opened in the email', () => {
  it('reads how wide the email is again, and widens the frame to it', async () => {
    const fixture = TestBed.createComponent(EmailViewer);
    fixture.componentRef.setInput('html', '<p>Hallo</p>');
    await fixture.whenStable();
    const iframe = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    // jsdom loads no `srcdoc`, and lays nothing out: a document of its own,
    // its widths said by hand.
    const email = document.implementation.createHTMLDocument();
    email.body.innerHTML = '<details><summary>⋯</summary><table width="600"></table></details>';
    let wide = 320;
    Object.defineProperty(email.documentElement, 'clientWidth', { get: () => 320 });
    Object.defineProperty(email.documentElement, 'scrollWidth', { get: () => wide });
    Object.defineProperty(iframe, 'contentDocument', { get: () => email });
    iframe.dispatchEvent(new Event('load'));
    expect(iframe.style.minInlineSize).toBe('');

    wide = 600;
    email.querySelector('details')!.dispatchEvent(new Event('toggle'));
    expect(iframe.style.minInlineSize).toBe('600px');

    wide = 320;
    email.querySelector('details')!.dispatchEvent(new Event('toggle'));
    expect(iframe.style.minInlineSize).toBe('');
  });
});
