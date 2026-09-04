import { TestBed } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Viewport } from './viewport';

describe('Viewport', () => {
  it('is wide where matchMedia is missing (jsdom): the CDK falls back to a no-op matcher', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(Viewport).narrow()).toBe(false);
  });

  it('reads the docking breakpoint from the CDK observer', () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: BreakpointObserver,
          useValue: {
            isMatched: (query: string) => query.includes('1199.98px'),
            observe: () => ({ pipe: () => ({ subscribe: () => ({ unsubscribe() {} }) }) }),
          },
        },
      ],
    });
    expect(TestBed.inject(Viewport).narrow()).toBe(true);
  });

  it('reports no keyboard inset where there is no visualViewport (jsdom, desktop)', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(Viewport).keyboardInset()).toBe(0);
  });
});
