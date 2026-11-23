import { Component, inject } from '@angular/core';

import { ComposeWindowFrame } from './compose-window';
import { ComposeWindows } from '../../../../core/email/compose-windows';

/**
 * The layer compose windows live on — mounted once by {@link ComposeWindows}
 * the first time one opens, over the whole page and click-through, so the
 * page stays usable around its windows.
 *
 * Windows sit on the bottom edge from the right corner leftwards, in the
 * order they were opened and with no gap between them (the service hands
 * each the number of its place; the window works out the position, and
 * slides to a new one). An expanded window leaves its place for the middle
 * of the screen, over a scrim that sends it back — and its place is still
 * there when it returns. Minimized
 * windows go on the dock's stack (`DockStack`), which shows its counter on
 * a layer of its own.
 */
@Component({
  selector: 'div[compose-dock]',
  imports: [ComposeWindowFrame],
  templateUrl: './compose-dock.html',
  styleUrl: './compose-dock.scss',
})
export class ComposeDock {
  protected readonly windows = inject(ComposeWindows);
}
