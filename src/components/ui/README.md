# UI Components

The `src/components/ui` directory contains small reusable primitives shared by feature components.

## Files

- `AnchoredPortal.tsx` renders anchored floating content through a portal.
- `controls.tsx` contains the shared form controls: `CustomSelect`,
  `SegmentedControl`, `SimpleSwitch`, and `SecretInput`.
- `dropdown-menu.tsx` wraps Radix Dropdown Menu with local menu styling.
- `Icons.tsx` contains shared icon wrappers and icon utilities.
- `SafeImage.tsx` renders images with safe loading and fallback behavior.
- `Tooltip.tsx` renders reusable tooltip behavior.
- `primitives.tsx` contains small shared UI building blocks.

## Guidelines

- Keep primitives generic and free of feature-specific store dependencies.
- Prefer existing primitives before adding new local UI patterns.
- Preserve keyboard, focus, and screen-reader behavior.
- Keep visual behavior stable across light and dark themes.
- Use `CustomSelect` for visible selection controls; feature components should
  not render native `<select>` elements directly.
- Use `Button` rather than a raw `<button>` so every control shares the same
  focus ring, disabled affordance, and `type="button"` default. Reach for
  `variant="bare"` when the call site supplies its own look; `className` wins
  over the variant's classes, because the primitive merges with `cn`.
