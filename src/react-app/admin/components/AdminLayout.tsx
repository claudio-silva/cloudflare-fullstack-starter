import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { APP_VERSION } from "../../../shared/app-version";
import { hasRole } from "../../../shared/roles";
import { config } from "../../../config";
import { adminConfig } from "../config";
import { useNavTrail, useNavigationMode, useRole } from "../nav";
import "../admin.css";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopNav } from "./AdminTopNav";
import { Forbidden } from "./StatusMessage";

const YEAR = new Date().getFullYear();

/**
 * Whether the sidebar is expanded: at first, by the window's width; then it
 * follows the window across `sidebarExpandedFrom`, both ways, and the toggle
 * in between.
 */
function useSidebarFollowsWidth() {
	const query = `(min-width: ${adminConfig.sidebarExpandedFrom}px)`;
	const [open, setOpen] = useState(() => window.matchMedia(query).matches);
	useEffect(() => {
		const mql = window.matchMedia(query);
		const follow = () => setOpen(mql.matches);
		mql.addEventListener("change", follow);
		return () => mql.removeEventListener("change", follow);
	}, [query]);
	return [open, setOpen] as const;
}

/**
 * The admin area's frame, inside the app's TopBar: the menu (sidebar or top
 * bar, see `useNavigationMode`), the page, and a footer at the bottom.
 */
export function AdminLayout() {
	const role = useRole();
	const mode = useNavigationMode();
	const [sidebarOpen, setSidebarOpen] = useSidebarFollowsWidth();
	// A page is open to the lowest role every menu item above it allows.
	const allowed = useNavTrail().every((item) => !item.minRole || hasRole(role, item.minRole));

	const content = (
		<div className="flex min-h-full flex-col bg-(--admin-bg)">
			<div className="flex flex-1 flex-col">{allowed ? <Outlet /> : <Forbidden inArea />}</div>
			<footer className="flex min-h-(--admin-footer-h) items-center border-t bg-(--admin-footer) text-xs text-muted-foreground">
				<div className="flex w-full flex-wrap justify-between gap-2 px-4 py-2 md:px-8">
					<span>
						© {YEAR} {config.appName}
					</span>
					<span>v{APP_VERSION}</span>
				</div>
			</footer>
		</div>
	);

	if (mode === "topbar") {
		return (
			<div className="flex h-full flex-col">
				<div className="shrink-0 border-b py-1.5">
					{/* Lined up with the pages (AdminPage). */}
					<div className="mx-auto w-full max-w-6xl px-2 md:px-6">
						<AdminTopNav />
					</div>
				</div>
				<div className="min-h-0 flex-1 overflow-auto">{content}</div>
			</div>
		);
	}

	return (
		<SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} className="h-full min-h-0">
			<AdminSidebar />
			<div className="min-h-0 min-w-0 flex-1 overflow-auto">{content}</div>
		</SidebarProvider>
	);
}
