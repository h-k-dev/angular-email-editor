import { Signal, computed, inject } from '@angular/core';
import { dawnDarkColor } from '@h-k-dev/angular-email-editor';

import { Paper } from '../../../../core/theme/paper';
import { PaperIsland } from './paper-island';

const asWritten = (color: string): string => color;

/**
 * How a swatch is shown on the paper it sits on: as written on a light
 * paper, drawn by Dawn on a dark one (`dawnDarkColor`) — what that colour
 * looks like in the email there. Picking it still applies the colour as
 * written, the light one: dark is only ever drawn. The paper is the
 * island's the picker belongs to (a compose window's, the designer's), else
 * the app's. In an injection context.
 */
export function injectSwatchPaint(): Signal<(color: string) => string> {
  const island = inject(PaperIsland, { optional: true });
  const paper = inject(Paper);
  return computed(() =>
    (island?.scheme() ?? paper.scheme()) === 'dark' ? dawnDarkColor : asWritten,
  );
}
