import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
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
			<SidebarFooter className="h-(--admin-footer-h) justify-center px-2 py-2">
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
	const { state, isMobile } = useSidebar();
	const Icon = item.icon;

	if (!item.children) {
		return (
			<SidebarMenuItem>
				<SidebarMenuButton asChild tooltip={item.title} isActive={isUnder(pathname, item.path!)} className="font-bold data-[active=true]:bg-(--admin-sidebar-active) data-[active=true]:font-bold">
					<Link to={item.path!} onClick={onNavigate}>
						{Icon && <Icon />}
						<span>{item.title}</span>
					</Link>
				</SidebarMenuButton>
			</SidebarMenuItem>
		);
	}

	// Collapsed to icons, a group has nowhere to open in place: its pages pop up
	// beside it, level with the button, and go away after a click inside or out.
	if (state === "collapsed" && !isMobile) {
		return (
			<SidebarMenuItem>
				<DropdownMenu modal={false}>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton isActive={isActive(item, pathname)} className="font-bold data-[active=true]:bg-(--admin-sidebar-active) data-[state=open]:bg-sidebar-accent">
							{Icon && <Icon />}
							<span>{item.title}</span>
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					{/* In the sidebar's colours, as part of it. */}
					<DropdownMenuContent side="right" align="start" sideOffset={12} className="min-w-52 border-sidebar-border bg-sidebar text-sidebar-foreground">
						<DropdownMenuLabel className="font-bold">{item.title}</DropdownMenuLabel>
						<DropdownMenuSeparator className="bg-sidebar-border" />
						<PopupItems items={item.children} />
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		);
	}

	return (
		<Collapsible asChild defaultOpen={isActive(item, pathname)} className="group/collapsible">
			<SidebarMenuItem>
				<CollapsibleTrigger asChild>
					<SidebarMenuButton tooltip={item.title} className="font-bold">
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
		// Only the left edge moves with the level: the right end lines up with level 1.
		<SidebarMenuSub className="mr-0 pr-0">
			{items.map((item) => (
				<SidebarMenuSubItem key={item.title}>
					{item.path ? (
						<SidebarMenuSubButton asChild isActive={isUnder(pathname, item.path)} className="data-[active=true]:bg-(--admin-sidebar-active) data-[active=true]:font-bold">
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

/** A group's pages in the popup; deeper levels show under a heading, indented. */
function PopupItems({ items, depth = 0 }: { items: AdminNavItem[]; depth?: number }) {
	const { pathname } = useLocation();
	return items.map((item) => (
		<div key={item.title} className={depth ? "pl-3" : undefined}>
			{item.path ? (
				<DropdownMenuItem
					asChild
					className={cn(
						"focus:bg-sidebar-accent focus:text-sidebar-accent-foreground [&_svg:not([class*='text-'])]:text-sidebar-foreground/70",
						isUnder(pathname, item.path) && "bg-(--admin-sidebar-active) font-bold",
					)}
				>
					<Link to={item.path}>
						{item.icon && <item.icon />}
						{item.title}
					</Link>
				</DropdownMenuItem>
			) : (
				<DropdownMenuLabel className="text-xs text-sidebar-foreground/70">{item.title}</DropdownMenuLabel>
			)}
			{item.children && <PopupItems items={item.children} depth={depth + 1} />}
		</div>
	));
}
