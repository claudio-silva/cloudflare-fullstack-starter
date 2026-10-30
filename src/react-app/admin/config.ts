import { LayoutDashboard, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import type { Role } from "../../shared/roles";
import type { PageCache } from "./page-loader";

/**
 * The admin area: an example backoffice to keep, restyle or delete
 * (docs/ADMIN.md). Everything it needs is in this folder, plus
 * src/worker/routes/admin/ for its API.
 */

export type AdminNavItem = {
	title: string;
	/** Absent for a group that only holds `children`. */
	path?: string;
	icon?: LucideIcon;
	/**
	 * Lowest role that sees the item and may open its pages (and its
	 * children's). The whole area already requires "admin"; the API enforces
	 * the same on its side.
	 */
	minRole?: Role;
	children?: AdminNavItem[];
};

/** The menu, and the source of each page's breadcrumbs and access rule. */
const nav: AdminNavItem[] = [
	{ title: "Dashboard", path: "/admin", icon: LayoutDashboard },
	{
		title: "Access",
		icon: ShieldCheck,
		minRole: "superadmin",
		children: [{ title: "Users", path: "/admin/users", icon: Users }],
	},
];

export const adminConfig = {
	/**
	 * "sidebar": vertical, collapsible menu. "topbar": horizontal menu below the
	 * header, with dropdowns. The default: the dashboard has a toggle, and the
	 * user's choice is remembered in the browser.
	 */
	navigation: "sidebar" as "sidebar" | "topbar",

	/**
	 * Below this window width the sidebar collapses to icons, and above it
	 * expands again, as the window crosses it (in between, the toggle decides).
	 * Under 768px it is a sheet instead.
	 */
	sidebarExpandedFrom: 1024,

	/** First breadcrumb on every page. */
	root: { title: "Admin", path: "/admin" },

	nav,

	/** What every `AdminTable` does unless its props say otherwise (docs/ADMIN_TABLE.md). Rows per page: `DEFAULT_PAGE_SIZE` in src/shared/admin-list.ts, which the server reads too. */
	table: {
		/** Every other row shaded (`--admin-table-stripe` in admin.css). */
		striped: false,
		/** "compact": shorter rows, for long lists of short values. */
		density: "normal" as "normal" | "compact",
		/** Load the next page with the one shown, so moving to it is instant. */
		prefetch: true,
		/** Pages kept for going back (how many, and for how many milliseconds), or `false`. */
		cache: { pages: 10, ttl: 60_000 } as PageCache,
	},
};
