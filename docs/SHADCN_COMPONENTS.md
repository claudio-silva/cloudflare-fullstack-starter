# shadcn/ui Components Reference

All components are pre-installed and available at `@/components/ui/`.

## Usage

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
```

## Available Components

| Component | Import | Description |
|-----------|--------|-------------|
| Accordion | `accordion` | Vertically stacked interactive headings revealing content sections |
| Alert | `alert` | Notification box for critical information |
| Alert Dialog | `alert-dialog` | Modal dialog for confirmations |
| Aspect Ratio | `aspect-ratio` | Container maintaining fixed aspect ratio |
| Avatar | `avatar` | Profile image or initials indicator |
| Badge | `badge` | Status descriptor or count indicator |
| Breadcrumb | `breadcrumb` | Navigation hierarchy display |
| Button | `button` | Interactive action element with variants |
| Calendar | `calendar` | Date selection and navigation |
| Card | `card` | Container for grouping related content |
| Carousel | `carousel` | Rotating content display |
| Chart | `chart` | Data visualization (bar, line, pie, etc.) |
| Checkbox | `checkbox` | Binary choice input |
| Collapsible | `collapsible` | Expandable/collapsible panel |
| Command | `command` | Command palette with search |
| Context Menu | `context-menu` | Right-click popup menu |
| Dialog | `dialog` | Modal overlay for forms/content |
| Drawer | `drawer` | Slide-in panel |
| Dropdown Menu | `dropdown-menu` | Selection menu on trigger |
| Form | `form` | Form builder for react-hook-form |
| Hover Card | `hover-card` | Popup on hover |
| Input | `input` | Text input field |
| Input OTP | `input-otp` | One-time password input |
| Label | `label` | Input label |
| Menubar | `menubar` | Horizontal dropdown menu bar |
| Navigation Menu | `navigation-menu` | Site navigation |
| Pagination | `pagination` | Page navigation controls |
| Popover | `popover` | Anchored overlay |
| Progress | `progress` | Task completion indicator |
| Radio Group | `radio-group` | Exclusive choice selection |
| Resizable | `resizable` | User-resizable container |
| Scroll Area | `scroll-area` | Custom scrollable region |
| Select | `select` | Dropdown selection |
| Separator | `separator` | Content divider |
| Sheet | `sheet` | Sliding overlay panel |
| Sidebar | `sidebar` | Navigation drawer |
| Skeleton | `skeleton` | Loading placeholder |
| Slider | `slider` | Range value selector |
| Sonner | `sonner` | Toast notifications |
| Switch | `switch` | On/off toggle |
| Table | `table` | Data table layout |
| Tabs | `tabs` | View switching |
| Textarea | `textarea` | Multiline text input |
| Toggle | `toggle` | Active/inactive button |
| Toggle Group | `toggle-group` | Related toggle buttons |
| Tooltip | `tooltip` | Hover information popup |

## Recipes (Build from Components)

### Data Table
Use `table` + `@tanstack/react-table`:
```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
```
See: https://ui.shadcn.com/docs/components/data-table

### Date Picker
Use `calendar` + `popover` + `date-fns`:
```tsx
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
```
See: https://ui.shadcn.com/docs/components/date-picker

### Combobox
Use `command` + `popover`:
```tsx
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
```
See: https://ui.shadcn.com/docs/components/combobox

## Adding New Components

```bash
npx shadcn-ui@latest add [component-name]
```

## Theme Customization

CSS variables in `src/react-app/index.css`:
- Colors, border radius, fonts
- Light/dark mode variants
- See: https://ui.shadcn.com/docs/theming

## Utilities

```tsx
import { cn } from "@/lib/utils";

// Merge class names conditionally
<div className={cn("base-class", isActive && "active-class")} />
```

---

*Official docs: https://ui.shadcn.com/*
