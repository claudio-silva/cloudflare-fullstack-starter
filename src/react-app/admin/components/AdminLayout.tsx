import { Outlet } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { APP_VERSION } from "../../../shared/app-version";
import { hasRole } from "../../../shared/roles";
import { config } from "../../../config";
import { useNavTrail, useNavigationMode, useRole } from "../nav";
import "../admin.css";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopNav } from "./AdminTopNav";
import { Forbidden } from "./StatusMessage";

const YEAR = new Date().getFullYear();

/**
 * The admin area's frame, inside the app's TopBar: the menu (sidebar or top
 * bar, see `useNavigationMode`), the page, and a footer at the bottom.
 */
export function AdminLayout() {
	const role = useRole();
	const mode = useNavigationMode();
	// A page is open to the lowest role every menu item above it allows.
	const allowed = useNavTrail().every((item) => !item.minRole || hasRole(role, item.minRole));

	const content = (
		<div className="flex min-h-full flex-col bg-(--admin-bg)">
			<div className="flex flex-1 flex-col">{allowed ? <Outlet /> : <Forbidden inArea />}</div>
			<footer className="border-t bg-(--admin-footer) text-xs text-muted-foreground">
				<div className="flex w-full flex-wrap justify-between gap-2 px-4 py-1 md:px-8">
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
		<SidebarProvider className="h-full min-h-0">
			<AdminSidebar />
			<div className="min-h-0 min-w-0 flex-1 overflow-auto">{content}</div>
		</SidebarProvider>
	);
}
