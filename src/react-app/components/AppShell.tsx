import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarTrigger,
} from "./ui/sidebar";
import { Separator } from "./ui/separator";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { authClient } from "@/lib/auth/client";

type NavItem = {
	label: string;
	path: string;
};

const navItems: NavItem[] = [
	{ label: "Home", path: "/" },
	{ label: "Profile", path: "/profile" },
];

function NavLinks() {
	const location = useLocation();
	return (
		<SidebarMenu>
			{navItems.map((item) => {
				const active = location.pathname === item.path;
				return (
					<SidebarMenuItem key={item.path}>
						<SidebarMenuButton asChild isActive={active}>
							<Link to={item.path}>{item.label}</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				);
			})}
		</SidebarMenu>
	);
}

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<SidebarProvider>
			<div className="flex min-h-screen bg-background text-foreground">
				<Sidebar className="border-r">
					<SidebarContent>
						<SidebarGroup>
							<SidebarGroupLabel>Menu</SidebarGroupLabel>
							<SidebarGroupContent>
								<NavLinks />
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>
				</Sidebar>
				<div className="flex flex-1 flex-col">
					<header className="flex h-14 items-center gap-4 border-b px-4">
						<SidebarTrigger />
						<div className="font-semibold text-lg tracking-tight">My App</div>
						<div className="ml-auto flex items-center gap-2">
							<Separator orientation="vertical" className="h-6" />
							<UserMenu />
						</div>
					</header>
					<main className="flex-1 overflow-auto p-6">{children}</main>
				</div>
			</div>
		</SidebarProvider>
	);
}

function UserMenu() {
	const { data: session } = authClient.useSession();
	const user = session?.user;
	const initials = user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" className="flex items-center gap-2 px-2">
					<Avatar className="h-8 w-8">
						<AvatarFallback>{initials}</AvatarFallback>
					</Avatar>
					<span className="text-sm font-medium">{user?.name || user?.email || "Account"}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-48">
				<DropdownMenuItem asChild>
					<Link to="/profile">Profile</Link>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => authClient.signOut.mutate()}>
					Logout
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
