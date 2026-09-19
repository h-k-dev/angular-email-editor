import { Component, inject } from '@angular/core';

import { ComposeWindowFrame } from './compose-window';
import { ComposeWindows } from '../../services/compose-windows';

/**
 * The layer compose windows live on — mounted once by {@link ComposeWindows}
 * the first time one opens, over the whole page and click-through, so the
 * page stays usable around its windows.
 *
 * Windows sit on the bottom edge from the right corner leftwards, each in a
 * place of its own that it keeps for as long as it is open (the service
 * hands it the number; the window works out the position). An expanded
 * window leaves its place for the middle of the screen, over a scrim that
 * sends it back — and its place is still there when it returns.
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
