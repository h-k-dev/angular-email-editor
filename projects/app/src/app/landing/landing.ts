import { Component } from '@angular/core';

// Angular Material
import { MatIconAnchor } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Compose } from '../compose/compose';
import { PaperIslandDirective } from '../compose/paper-island';

/**
 * The front page: the composer as a document on the whole screen, under a
 * slim bar on its paper with one way out — home, to the mailbox. Nothing of
 * the mailbox's layout reaches in here, and nothing of this one reaches the
 * mailbox: each page draws its own chrome.
 */
@Component({
  selector: 'app-landing',
  imports: [TranslatePipe, MatIconAnchor, MatIcon, RouterLink, Compose, PaperIslandDirective],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {}
