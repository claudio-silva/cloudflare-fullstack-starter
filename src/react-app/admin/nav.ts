import { useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { authClient } from "@/lib/auth/client";
import { hasRole } from "../../shared/roles";
import { adminConfig, type AdminNavItem } from "./config";

/** The signed-in user's role (from the session, set at sign-in). */
export function useRole(): string | undefined {
	return authClient.useSession().data?.user.role ?? undefined;
}

/** `path` is the item's page or one below it ("/admin/users/42" is under "/admin/users"). */
export const isUnder = (pathname: string, path: string) =>
	path === adminConfig.root.path ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);

/** The menu as `role` may see it: items above the role, and groups left empty, removed. */
export function visibleNav(items: AdminNavItem[], role: string | undefined): AdminNavItem[] {
	return items.flatMap((item) => {
		if (item.minRole && !hasRole(role, item.minRole)) return [];
		if (!item.children) return [item];
		const children = visibleNav(item.children, role);
		return children.length ? [{ ...item, children }] : [];
	});
}

/** The items from the top of the menu down to the one `pathname` is under, deepest match first wins. */
export function navTrail(items: AdminNavItem[], pathname: string): AdminNavItem[] {
	for (const item of items) {
		const below = item.children ? navTrail(item.children, pathname) : [];
		if (below.length) return [item, ...below];
		if (item.path && isUnder(pathname, item.path)) return [item];
	}
	return [];
}

/** The current page's place in the menu. */
export function useNavTrail(): AdminNavItem[] {
	return navTrail(adminConfig.nav, useLocation().pathname);
}

/** Whether the item, or one of its children, is the current page. */
export const isActive = (item: AdminNavItem, pathname: string): boolean =>
	(item.path !== undefined && isUnder(pathname, item.path)) || (item.children ?? []).some((child) => isActive(child, pathname));

export type NavigationMode = "sidebar" | "topbar";

const MODE_KEY = "admin-navigation";
const modeListeners = new Set<() => void>();

function readMode(): NavigationMode {
	const saved = localStorage.getItem(MODE_KEY);
	return saved === "sidebar" || saved === "topbar" ? saved : adminConfig.navigation;
}

/** Vertical or horizontal menu: the user's last choice (the dashboard's toggle), else `adminConfig.navigation`. */
export function useNavigationMode(): NavigationMode {
	return useSyncExternalStore((listener) => {
		modeListeners.add(listener);
		return () => modeListeners.delete(listener);
	}, readMode);
}

export function setNavigationMode(mode: NavigationMode) {
	localStorage.setItem(MODE_KEY, mode);
	modeListeners.forEach((listener) => listener());
}
