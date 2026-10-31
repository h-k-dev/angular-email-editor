import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';
import { vi } from 'vitest';

import { DialogDefaults, provideDialogDefaults } from './dialogs';

describe('provideDialogDefaults', () => {
  afterEach(() => vi.restoreAllMocks());

  /** The defaults on a browser whose WebGL answers `gl` (null: no GPU). */
  function defaults(gl: unknown, options?: DialogDefaults): MatDialogConfig {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl as never);
    TestBed.configureTestingModule({ providers: [provideDialogDefaults(options)] });
    return TestBed.inject(MAT_DIALOG_DEFAULT_OPTIONS);
  }

  const gpu = { getExtension: () => ({ loseContext: () => undefined }) };

  it('blurs the page behind every dialog, over the stock dim, where a GPU paints it', () => {
    const config = defaults(gpu);
    expect(config.backdropClass).toEqual(['cdk-overlay-dark-backdrop', 'dialog-backdrop-blur']);
    // Material's own defaults stay: these replace them whole.
    expect(config.hasBackdrop).toBe(true);
    expect(config.restoreFocus).toBe(true);
  });

  it('keeps the stock backdrop without a GPU, or with the blur turned off', () => {
    expect(defaults(null).backdropClass).toBe('cdk-overlay-dark-backdrop');
    TestBed.resetTestingModule();
    expect(defaults(gpu, { blur: false }).backdropClass).toBe('cdk-overlay-dark-backdrop');
  });
});
