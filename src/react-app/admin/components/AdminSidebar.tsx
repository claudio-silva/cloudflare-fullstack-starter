import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarRail,
	useSidebar,
} from "@/components/ui/sidebar";
import { adminConfig, type AdminNavItem } from "../config";
import { isActive, isUnder, useRole, visibleNav } from "../nav";

/** Vertical navigation: shadcn's Sidebar, below the app's header; a sheet on small screens. */
export function AdminSidebar() {
	const items = visibleNav(adminConfig.nav, useRole());
	const { setOpenMobile } = useSidebar();
	const closeOnMobile = () => setOpenMobile(false);

	return (
		// Below the TopBar (h-14) and whatever banner the HTTP layer shows above it.
		<Sidebar collapsible="icon" className="top-[calc(var(--app-banner-h,0px)+3.5rem)] h-auto">
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Administration</SidebarGroupLabel>
					<SidebarMenu>
						{items.map((item) => (
							<TopLevelItem key={item.title} item={item} onNavigate={closeOnMobile} />
						))}
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter className="bg-(--admin-sidebar-footer)">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="Back to the app">
							<Link to="/" onClick={closeOnMobile}>
								<ArrowLeft />
								<span>Back to the app</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}

function TopLevelItem({ item, onNavigate }: { item: AdminNavItem; onNavigate: () => void }) {
	const { pathname } = useLocation();
	const { state, setOpen } = useSidebar();
	const Icon = item.icon;

	if (!item.children) {
		return (
			<SidebarMenuItem>
				<SidebarMenuButton asChild tooltip={item.title} isActive={isUnder(pathname, item.path!)} className="font-bold data-[active=true]:font-bold">
					<Link to={item.path!} onClick={onNavigate}>
						{Icon && <Icon />}
						<span>{item.title}</span>
					</Link>
				</SidebarMenuButton>
			</SidebarMenuItem>
		);
	}

	return (
		<Collapsible asChild defaultOpen={isActive(item, pathname)} className="group/collapsible">
			<SidebarMenuItem>
				<CollapsibleTrigger asChild>
					{/* Collapsed to icons, a group has nowhere to open: expand the sidebar instead. */}
					<SidebarMenuButton
						tooltip={item.title}
						isActive={isActive(item, pathname)}
						className="font-bold data-[active=true]:font-bold"
						onClick={() => state === "collapsed" && setOpen(true)}
					>
						{Icon && <Icon />}
						<span>{item.title}</span>
						<ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
					</SidebarMenuButton>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<SubItems items={item.children} onNavigate={onNavigate} />
				</CollapsibleContent>
			</SidebarMenuItem>
		</Collapsible>
	);
}

/** Second level and below; deeper levels nest, always open. */
function SubItems({ items, onNavigate }: { items: AdminNavItem[]; onNavigate: () => void }) {
	const { pathname } = useLocation();
	return (
		<SidebarMenuSub>
			{items.map((item) => (
				<SidebarMenuSubItem key={item.title}>
					{item.path ? (
						<SidebarMenuSubButton asChild isActive={isUnder(pathname, item.path)}>
							<Link to={item.path} onClick={onNavigate}>
								{item.icon && <item.icon />}
								<span>{item.title}</span>
							</Link>
						</SidebarMenuSubButton>
					) : (
						<span className="flex h-7 items-center px-2 text-xs font-medium text-sidebar-foreground/70">{item.title}</span>
					)}
					{item.children && <SubItems items={item.children} onNavigate={onNavigate} />}
				</SidebarMenuSubItem>
			))}
		</SidebarMenuSub>
	);
}
