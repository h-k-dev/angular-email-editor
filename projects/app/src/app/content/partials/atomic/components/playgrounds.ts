import { Type } from '@angular/core';

/**
 * Each component's playground, by its entry point's name — a chunk of its
 * own, loaded when its page (or `/playground/<id>`) is opened. The ids are
 * `ENTRY_PAGES`'.
 */
export const PLAYGROUNDS: Readonly<Record<string, () => Promise<Type<unknown>>>> = {
  'address-input': () =>
    import('./address-input/address-input-playground').then((m) => m.AddressInputPlayground),
  'address-chip': () =>
    import('./address-chip/address-chip-playground').then((m) => m.AddressChipPlayground),
  'attachment-chip': () =>
    import('./attachment-chip/attachment-chip-playground').then((m) => m.AttachmentChipPlayground),
  'attachment-chips': () =>
    import('./attachment-chips/attachment-chips-playground').then(
      (m) => m.AttachmentChipsPlayground,
    ),
  'chat-input': () =>
    import('./chat-input/chat-input-playground').then((m) => m.ChatInputPlayground),
  'split-button': () =>
    import('./split-button/split-button-playground').then((m) => m.SplitButtonPlayground),
  'suggestion-menu': () =>
    import('./suggestion-menu/suggestion-menu-playground').then((m) => m.SuggestionMenuPlayground),
  'toggle-button-group': () =>
    import('./toggle-button-group/toggle-button-group-playground').then(
      (m) => m.ToggleButtonGroupPlayground,
    ),
  material: () => import('./material/material-playground').then((m) => m.MaterialPlayground),
  actions: () => import('./actions/actions-playground').then((m) => m.ActionsPlayground),
  focus: () => import('./focus/focus-playground').then((m) => m.FocusPlayground),
  anchor: () => import('./anchor/anchor-playground').then((m) => m.AnchorPlayground),
  image: () => import('./image/image-playground').then((m) => m.ImagePlayground),
  proposal: () => import('./proposal/proposal-playground').then((m) => m.ProposalPlayground),
  metrics: () => import('./metrics/metrics-playground').then((m) => m.MetricsPlayground),
  address: () => import('./address/address-playground').then((m) => m.AddressPlayground),
  palette: () => import('./palette/palette-playground').then((m) => m.PalettePlayground),
  fonts: () => import('./fonts/fonts-playground').then((m) => m.FontsPlayground),
};
