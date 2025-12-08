# Cloudflare Fullstack Template (RVHS)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/claudio-silva/cloudflare-fullstack-starter)

This template provides a complete fullstack setup for building modern React applications with TypeScript, Vite, Hono backend, Cloudflare Workers, and shadcn/ui components. It features hot module replacement, ESLint integration, Tailwind CSS styling, and the flexibility of Workers deployments.

<!-- dash-content-start -->

🚀 Supercharge your web development with this powerful stack:

- [**React**](https://react.dev/) - A modern UI library for building interactive interfaces
- [**Vite**](https://vite.dev/) - Lightning-fast build tooling and development server
- [**Hono**](https://hono.dev/) - Ultralight, modern backend framework
- [**Cloudflare Workers**](https://developers.cloudflare.com/workers/) - Edge computing platform for global deployment
- [**shadcn/ui**](https://ui.shadcn.com/) - Beautifully designed components built with Radix UI and Tailwind CSS
- [**Tailwind CSS**](https://tailwindcss.com/) - Utility-first CSS framework for rapid UI development

### ✨ Key Features

- 🔥 Hot Module Replacement (HMR) for rapid development
- 📦 TypeScript support out of the box
- 🛠️ ESLint configuration included
- ⚡ Zero-config deployment to Cloudflare's global network
- 🎯 API routes with Hono's elegant routing
- 🔄 Full-stack development setup
- 🎨 Pre-configured shadcn/ui components with default theme
- 🌈 Tailwind CSS v3.x for styling
- 🌓 Dark/light theme support
- 📱 Responsive design ready

Get started in minutes with local development or deploy directly via the Cloudflare dashboard. Perfect for building modern, performant web applications at the edge with beautiful UI components.

<!-- dash-content-end -->

## Getting Started

### Clone this template

```bash
git clone https://github.com/claudio-silva/cloudflare-fullstack-starter.git your-project-name
cd your-project-name
```

### Install dependencies

```bash
npm install
```

### Start development server

```bash
npm run dev
```

Your application will be available at [http://localhost:5173](http://localhost:5173).

## What's Included

### Frontend Stack
- **React 19** - Latest React with concurrent features
- **TypeScript** - Type-safe JavaScript
- **Vite** - Fast build tool and dev server
- **Tailwind CSS v3.x** - Utility-first CSS framework
- **shadcn/ui** - Pre-built accessible components

### Backend Stack
- **Hono** - Lightweight web framework
- **Cloudflare Workers** - Edge runtime environment

### Development Tools
- **ESLint** - Code linting
- **PostCSS** - CSS processing
- **Wrangler** - Cloudflare Workers CLI

### UI Components
- Most official shadcn/ui components are already preinstalled in this template. You can use them directly from `@/components/ui/`.
- To add new or updated components as they become available, use:

```bash
npx shadcn-ui@latest add [component-name]
```

| Component Name | Tag Name | Description |
|---|---|---|
| Accordion | `accordion` | A vertically stacked set of interactive headings that each reveal a section of content. |
| Alert Dialog | `alert-dialog` | Modal dialog asking users to confirm or acknowledge an action. |
| Alert | `alert` | Stylized notification box used to draw attention to critical information. |
| Aspect Ratio | `aspect-ratio` | Container that maintains a fixed aspect ratio for its contents. |
| Avatar | `avatar` | Circular profile image or initials indicator. |
| Badge | `badge` | Small count or status descriptor for UI elements. |
| Breadcrumb | `breadcrumb` | Navigation aid displaying the user's current location in a hierarchy. |
| Button | `button` | Interactive element for user actions, supporting multiple variants. |
| Calendar | `calendar` | Visual calendar for date selection and navigation. |
| Card | `card` | Structured container for grouping related content. |
| Carousel | `carousel` | Rotating display of images or content panels. |
| Chart | `chart` | Data visualization components such as bar, line, pie, and more. |
| Checkbox | `checkbox` | Input control representing a binary choice. |
| Collapsible | `collapsible` | Panel or section that can be expanded or collapsed. |
| Combobox | `combobox` | Combo input allowing selection from a list or custom input. |
| Command | `command` | Command palette UI for actions, often with search or shortcut support. |
| Context Menu | `context-menu` | Customizable popup menu appearing on right-click. |
| Data Table | (recipe) | Not a standalone component. Advanced tables can be built using the `table` component and `@tanstack/react-table` npm package. Check the recipe in [the official documentation](https://ui.shadcn.com/docs/components/data-table) |
| Date Picker | (recipe) | Not a standalone component. It can be built with the `calendar` and `popover` components and the `date-fns` npm package. Check the recipe in [the official documentation](https://ui.shadcn.com/docs/components/date-picker) |
| Dialog | `dialog` | Modal overlay for embeddable interactive content or forms. |
| Drawer | `drawer` | Slide-in panel from an edge of the screen containing additional content. |
| Dropdown Menu | `dropdown-menu` | Menu that appears on trigger for selecting items. |
| Form | `form` | A component for building forms, built for `react-hook-form`. Depends on `react-hook-form`, `@hookform/resolvers`, and `zod` npm packages. |
| Hover Card | `hover-card` | Popup card appearing on hover, often used for previews. |
| Input OTP | `input-otp` | Input fields for entering one-time passwords or verification codes. |
| Input | `input` | Standard text fields for user input. |
| Label | `label` | Text label describing an associated input component. |
| Menubar | `menubar` | Horizontal bar of dropdown menus, common in application headers. |
| Navigation Menu | `navigation-menu` | Feature-rich menu for navigating site or application sections. |
| Pagination | `pagination` | Controls for navigating divided content pages. |
| Popover | `popover` | Layered contextual overlay element anchored to a trigger. |
| Progress | `progress` | Displays completion progress for a task or action. |
| Radio Group | `radio-group` | A set of radio buttons for exclusive choice selection. |
| Resizable | `resizable` | Container whose dimensions can be changed by the user. |
| Scroll-area | `scroll-area` | Customizable scrollable content region. |
| Select | `select` | Dropdown list for selecting a single item from multiple options. |
| Separator | `separator` | Horizontal or vertical line for dividing content. |
| Sheet | `sheet` | Panel sliding over the UI for displaying additional content or actions. |
| Sidebar | `sidebar` | Persistent navigation or content drawer anchored to a screen edge. |
| Skeleton | `skeleton` | Placeholder elements mimicking page layout while content loads. |
| Slider | `slider` | Adjustable bar for selecting a value from a range. |
| Sonner | `sonner` | Toast-style notification messages that appear temporarily. |
| Switch | `switch` | Toggle control for binary on/off states. |
| Table | `table` | Generic table layout for organizing content in rows and columns. |
| Tabs | `tabs` | Layout pattern for switching between different views or content panels. |
| Textarea | `textarea` | Multiline text input field. |
| Toggle Group | `toggle-group` | Set of related toggle buttons with single or multiple selection. |
| Toggle | `toggle` | Button that switches between active and inactive states. |
| Tooltip | `tooltip` | Small popup showing additional information on hover or focus. |

### Path Aliases

- Use `@/components/ui/` to import any shadcn/ui component (e.g., `import { Button } from '@/components/ui/button'`)
- Use `@/lib/` to import utility helpers (e.g., `import { cn } from "@/lib/utils"`)

### shadcn/ui Theme & Customization

- The template comes with the official shadcn/ui theme, supporting light and dark mode out of the box.
- Theme colors and radii are easily customizable via CSS variables in `src/react-app/index.css`.

### Utilities

- Common utility helpers (like `cn` for class merging) are available in `src/react-app/lib/utils.ts`.

## Project Structure

```
├── src/
│   ├── react-app/          # React application
│   │   ├── components/     # React components
│   │   │   └── ui/        # shadcn/ui components
│   │   ├── lib/           # Utility functions
│   │   ├── assets/        # Static assets
│   │   └── ...
│   └── worker/            # Cloudflare Worker (API)
├── public/                # Public assets
├── tailwind.config.js     # Tailwind configuration
├── postcss.config.js      # PostCSS configuration
└── wrangler.json         # Cloudflare Workers configuration
```

## Development

### Adding New Components

To add a new shadcn/ui component:

```bash
npx shadcn-ui@latest add [component-name]
```

### API Development

Edit `src/worker/index.ts` to add new API endpoints:

```typescript
app.get('/api/hello', (c) => {
  return c.json({ message: 'Hello from Hono!' })
})
```

### Styling

This template uses Tailwind CSS for styling. You can:
- Use utility classes directly in your components
- Customize the theme in `tailwind.config.js`
- Add custom CSS in `src/react-app/index.css`

## Production

### Build for production

```bash
npm run build
```

### Test the built app locally

After building, you can preview the production build locally with:

```bash
npm run preview
```

This will start a local server (by default at [http://localhost:4173](http://localhost:4173)) serving the built app as it would appear in production.

### Deploy to Cloudflare Workers

```bash
npm run deploy
```

## Additional Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Vite Documentation](https://vitejs.dev/guide/)
- [React Documentation](https://reactjs.org/)
- [Hono Documentation](https://hono.dev/)
- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

## License

This template is open source and available under the [MIT License](LICENSE).  
It was based on the [Cloudflare Fullstack Template](https://github.com/cloudflare/templates/tree/main/vite-react-template)

(c) 2025 Claudio Silva