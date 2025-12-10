import { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, Settings } from "lucide-react";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { ModeToggle } from "./ModeToggle";
import { Logo } from "./Logo";
import { authClient } from "@/lib/auth/client";

/** URL to navigate to after logout. Defaults to "/" */
const LOGOUT_REDIRECT_URL = "/";

interface TopBarProps {
	children: ReactNode;
}

function getUserInitials(name?: string | null, email?: string): string {
	if (name) {
		return name
			.split(" ")
			.map((n) => n[0])
			.join("")
			.toUpperCase()
			.slice(0, 2);
	}
	if (email) {
		return email[0].toUpperCase();
	}
	return "U";
}

function UserMenu() {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const user = session?.user;

	const handleSignOut = async () => {
		try {
			await authClient.signOut({
				fetchOptions: {
					onSuccess: () => {
						navigate(LOGOUT_REDIRECT_URL, { replace: true });
					},
				},
			});
		} catch (error) {
			console.error("Failed to sign out:", error);
		}
	};

	if (!user) return null;

	const initials = getUserInitials(user.name, user.email);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" className="h-9 w-9 rounded-full p-0">
					<Avatar className="h-8 w-8">
						<AvatarFallback className="text-sm bg-primary text-primary-foreground">
							{initials}
						</AvatarFallback>
					</Avatar>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuLabel>
					<div className="flex items-start gap-3">
						<Avatar className="h-9 w-9 shrink-0">
							<AvatarFallback className="text-sm bg-primary text-primary-foreground">
								{initials}
							</AvatarFallback>
						</Avatar>
						<div className="flex flex-col space-y-1 min-w-0">
							<p className="text-sm font-medium leading-none truncate">{user.name || "User"}</p>
							<p className="text-xs text-muted-foreground leading-none truncate">{user.email}</p>
						</div>
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/profile" className="cursor-pointer">
						<Settings className="mr-2 h-4 w-4" />
						Profile
					</Link>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:text-destructive">
					<LogOut className="mr-2 h-4 w-4" />
					Sign Out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function TopBar({ children }: TopBarProps) {
	const { data: session } = authClient.useSession();

	return (
		<div className="fixed inset-0 flex flex-col bg-background text-foreground">
			<header className="flex h-14 shrink-0 items-center border-b px-4">
				{/* Logo and App Name */}
				<Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0">
					<Logo className="h-8 w-auto" />
					<span className="text-lg font-semibold tracking-tight">My App</span>
				</Link>

				{/* Spacer */}
				<div className="flex-1" />

				{/* Right side: Theme toggle and User menu */}
				<div className="flex items-center gap-2 shrink-0">
					<ModeToggle />
					{session?.user && (
						<>
							<div className="w-px h-6 bg-border" />
							<UserMenu />
						</>
					)}
				</div>
			</header>
			<main className="flex-1 overflow-auto">{children}</main>
		</div>
	);
}


