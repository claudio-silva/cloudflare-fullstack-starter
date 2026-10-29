# shadcn/ui components

The full [shadcn/ui](https://ui.shadcn.com/docs/components) catalogue (style `new-york`, see `components.json`), with what is installed in `src/react-app/components/ui/` and how to add the rest.

## Contents

- [When to use a catalogue component](#when-to-use-a-catalogue-component)
- [Changing a component](#changing-a-component)
- [Catalogue](#catalogue)
- [Patterns built from components](#patterns-built-from-components)
- [Setup notes](#setup-notes)

## When to use a catalogue component

- **Building something the catalogue has** (a dialog, a select, a tooltip, a data table): use the catalogue component, installing it first if needed, instead of writing an equivalent.
- **Building something different:** write it, composed from catalogue components where they fit.
- **Nothing in the catalogue fits:** a third-party registry or library is fine. Add its packages under *Project choices* in `docs/DEPENDENCIES.md`.

Installed components import directly:

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
```

The rest install with the CLI, which writes the file and adds its packages:

```bash
npx shadcn@latest add calendar
```

Only components whose dependencies are `radix-ui` and the class helpers are installed by default, plus `command` and `form`. The ones marked *heavy* below pull in a library of their own. Why: `docs/DEPENDENCIES.md`, *UI components*.

## Changing a component

From the lightest change to the heaviest:

1. **Look and feel:** change the theme's CSS variables in `src/react-app/index.css` (colours, radius, fonts, light and dark). See [Theming](https://ui.shadcn.com/docs/theming).
2. **A small adjustment to a component** (a variant, a size, a default class): edit the file in `components/ui/` in place, and mark the change with a `// project:` comment so it survives a later `npx shadcn add <name> --overwrite`.
3. **A new component:** a new file outside `components/ui/` (for example `components/DateRangeField.tsx`). Compose it from catalogue components, or start from a copy of the closest one and change the copy.

Rewriting an official component in place, so that it no longer behaves like the one in the shadcn docs, misleads anyone who reads it as the standard one. Give the result a different name (step 3). Adding a variant to `Button`, or any step-2 change, is fine.

## Catalogue

*Heavy* marks components that add a library of their own; the library is in brackets.

| Component | Installed | What it is |
|---|---|---|
| `accordion` | yes | Stacked headings that expand to show their section |
| `alert` | yes | Inline callout for important information |
| `alert-dialog` | yes | Modal that interrupts to confirm an action |
| `aspect-ratio` | yes | Keeps content at a fixed width/height ratio |
| `attachment` | `npx shadcn add attachment` | File or image attachment with upload state and actions (chat) |
| `avatar` | yes | User image with a fallback |
| `badge` | yes | Small status or count label |
| `breadcrumb` | yes | Path to the current page |
| `bubble` | `npx shadcn add bubble` | Chat message bubble, with grouping and reactions (chat) |
| `button` | yes | Button, with variants and sizes |
| `button-group` | yes | Buttons joined into one control |
| `calendar` | `npx shadcn add calendar` | Month calendar for picking dates. *Heavy* (`react-day-picker`, `date-fns`) |
| `card` | yes | Container with header, content and footer |
| `carousel` | `npx shadcn add carousel` | Slides with swipe and arrows. *Heavy* (`embla-carousel-react`) |
| `chart` | `npx shadcn add chart` | Themed charts. *Heavy* (`recharts`) |
| `checkbox` | yes | Checkbox |
| `collapsible` | yes | Panel that shows and hides its content |
| `combobox` | `npx shadcn add combobox` | Input with a filtered list of suggestions. *Heavy* (`@base-ui/react`); see [Combobox](#combobox) for one from installed parts |
| `command` | yes | Searchable command list and palette (`cmdk`) |
| `context-menu` | yes | Right-click menu |
| `dialog` | yes | Modal window |
| `direction` | `npx shadcn add direction` | Provider that sets text direction (right-to-left languages) |
| `drawer` | `npx shadcn add drawer` | Panel that slides up from the bottom, for mobile. *Heavy* (`vaul`) |
| `dropdown-menu` | yes | Menu opened from a button |
| `empty` | yes | Empty state: icon, message and actions |
| `field` | yes | Label, control, description and error laid out as one form field |
| `form` | yes | `react-hook-form` bindings with labels and error messages |
| `hover-card` | yes | Preview card shown on hover |
| `input` | yes | Text input |
| `input-group` | yes | Input with icons, buttons or text attached |
| `input-otp` | `npx shadcn add input-otp` | One-time code input. *Heavy* (`input-otp`) |
| `item` | yes | Row with media, title, description and actions, for lists |
| `kbd` | yes | Keyboard key, for shortcuts |
| `label` | yes | Accessible label for a control |
| `marker` | `npx shadcn add marker` | Inline status, note or labelled separator in a conversation (chat) |
| `menubar` | yes | Desktop-style menu bar |
| `message` | `npx shadcn add message` | Conversation message with avatar, header and footer (chat) |
| `message-scroller` | `npx shadcn add message-scroller` | Chat scroll container that follows streamed replies. *Heavy* (`@shadcn/react`) |
| `native-select` | yes | Styled native `<select>` |
| `navigation-menu` | yes | Site navigation with dropdown panels |
| `pagination` | yes | Page links with previous and next |
| `popover` | yes | Floating panel anchored to a trigger |
| `progress` | yes | Progress bar |
| `radio-group` | yes | One choice among several |
| `resizable` | `npx shadcn add resizable` | Panels the user can resize. *Heavy* (`react-resizable-panels`) |
| `scroll-area` | yes | Scroll container with styled scrollbars |
| `select` | yes | Custom dropdown select |
| `separator` | yes | Horizontal or vertical divider |
| `sheet` | yes | Panel that slides in from a screen edge |
| `sidebar` | yes | Collapsible app sidebar |
| `skeleton` | yes | Loading placeholder |
| `slider` | yes | Range slider |
| `sonner` | not installed | Toaster wrapper. The starter mounts `sonner`'s `Toaster` directly in `main.tsx`; call `toast()` from `sonner` |
| `spinner` | yes | Loading spinner |
| `switch` | yes | On/off switch |
| `table` | yes | Styled table elements |
| `tabs` | yes | Tabbed views |
| `textarea` | yes | Multi-line text input |
| `toggle` | yes | Two-state button |
| `toggle-group` | yes | Set of toggles, single or multiple choice |
| `tooltip` | yes | Hint shown on hover or focus |

The catalogue grows. `https://ui.shadcn.com/r/styles/new-york-v4/registry.json` lists the current components (entries of type `registry:ui`).

## Patterns built from components

shadcn documents these as recipes rather than components. They are recommendations, not requirements: use them when they fit.

### Combobox

- **From installed parts:** a `Popover` whose trigger is a `Button` showing the selected value, and whose content is a `Command` (`CommandInput`, `CommandList`, `CommandEmpty`, `CommandItem`s). Selecting an item sets the value and closes the popover.
- **Official component:** `npx shadcn add combobox` (adds `@base-ui/react`). See [Combobox](https://ui.shadcn.com/docs/components/combobox).

### Date picker

`popover` + `calendar` (install `calendar` first). See [Date Picker](https://ui.shadcn.com/docs/components/date-picker).

### Data table

`table` + [TanStack Table](https://tanstack.com/table) (`npm install @tanstack/react-table`) for sorting, filtering and pagination. See [Data Table](https://ui.shadcn.com/docs/components/data-table). A plain list with no such features needs only `table`.

## Setup notes

- **Class names:** components import `cn` from the `cn` package. `@/lib/utils` re-exports it for code written against the older path.
- **Tooltips:** `TooltipProvider` is mounted once in `main.tsx`, above the app.
- **`useIsMobile`:** `src/react-app/hooks/use-mobile.ts` (used by `sidebar`) is a `// project:` version that follows the media query with `useSyncExternalStore`. `npx shadcn add sidebar --overwrite` would replace it with shadcn's.
- **Lint:** `eslint.config.js` turns off, for `components/ui/` only, the rules that flag code as the CLI writes it, so components can stay as installed.
- **Upgrades:** `components/ui/` belongs to the project. An upgrade of the starter does not add, remove or overwrite components there; `UPGRADING.md` lists what changed in the starter's own set.
