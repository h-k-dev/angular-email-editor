import { Component } from '@angular/core';

import { Compose } from './compose';

/**
 * The front page: the composer as a document on the whole screen, with no
 * header — its one way out, home to the mailbox, is in the sheet's bar (the
 * composer's). Nothing of
 * the mailbox's layout reaches in here, and nothing of this one reaches the
 * mailbox: each page draws its own chrome.
 */
@Component({
  selector: 'app-landing',
  imports: [Compose],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {}
