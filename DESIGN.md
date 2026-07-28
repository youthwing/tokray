# Design System

## Theme

Instrumentation bench with paired themes: a true-white light surface and a neutral graphite dark surface. Cobalt marks interaction, amber is reserved for uncertainty, and context categories retain stable semantic colors across both themes. Theme choice is persisted locally.

## Color Palette

All implementation colors use OKLCH.

- Background: `oklch(1 0 0)`
- Surface: `oklch(0.975 0.006 250)`
- Raised surface: `oklch(0.995 0.003 250)`
- Ink: `oklch(0.21 0.025 255)`
- Muted ink: `oklch(0.48 0.025 255)`
- Hairline: `oklch(0.89 0.012 250)`
- Primary cobalt: `oklch(0.55 0.149 250)`
- Primary dark: `oklch(0.43 0.13 250)`
- Amber uncertainty: `oklch(0.72 0.15 75)`
- Green exact/success: `oklch(0.58 0.13 155)`
- Red anomaly: `oklch(0.58 0.18 28)`
- Cyan assistant: `oklch(0.67 0.12 210)`
- Violet resident: `oklch(0.58 0.13 305)`

## Typography

Use the local system sans stack for interface text and the local monospace stack for token values, model ids, paths, and frame numbers. No network fonts. Base text is 14px with a compact 1.4 line height; headings use fixed sizes from 16px to 24px.

## Layout

- Desktop: 284px session rail plus a flexible analysis workspace.
- The rail starts with dynamic adapter filters and session search so providers can be switched without scanning the full list.
- Timeline owns the primary horizontal space and remains directly selectable.
- Tabs switch full-width analysis bands; panels are separated with hairlines, not floating cards.
- Mobile: session rail becomes a top selector; metrics wrap; frame detail becomes a vertical flow.

## Components

- Brand mark: paired context brackets enclose a scanned Token node. The cobalt tile is the canonical app icon in both themes; do not recolor it with provider or severity colors. Use `tokray-mark.svg` for compact placements and `tokray-lockup.svg` where the wordmark must travel with the symbol.
- Buttons: 6px radius, icon-first for refresh, theme-independent focus rings.
- Tabs: underline/filled-track hybrid with stable dimensions.
- Status chips: compact, semantic, and always paired with text.
- Tables: sticky headers, aligned numeric columns, row selection without layout shift.
- Inspector: master-detail split, with block attribution, confidence, token method, and source reference.
- Metrics: selected-call scope, plain-language labels, native help tooltips, and explicit overshoot warnings when estimates disagree with provider totals.
- Conversation: messages-first transcript with search; tool calls and results are filtered separately and collapsed by default.
- Loading: structural skeleton rows and timeline bands.
- Empty/error states: inline in the working area with a direct recovery action.

## Motion

Use 160-200ms transitions for selection, panel changes, and hover feedback. Chart updates may crossfade. Disable nonessential transitions under reduced motion.
