import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
	navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { adminConfig, type AdminNavItem } from "../config";
import { isActive, isUnder, useRole, visibleNav } from "../nav";

/**
 * Radix opens a group on hover and closes it when the pointer leaves; here it
 * opens and closes on click only. Preventing these events is how Radix lets
 * that be turned off.
 */
const clickOnly = {
	onPointerMove: (event: { preventDefault(): void }) => event.preventDefault(),
	onPointerLeave: (event: { preventDefault(): void }) => event.preventDefault(),
};

/** Horizontal navigation: shadcn's NavigationMenu, a dropdown per group, opened by a click. */
export function AdminTopNav() {
	const items = visibleNav(adminConfig.nav, useRole());
	const { pathname } = useLocation();

	return (
		<NavigationMenu viewport={false} className="max-w-none justify-start">
			<NavigationMenuList className="flex-wrap justify-start">
				{items.map((item) => {
					const Icon = item.icon;
					const active = isActive(item, pathname);
					return item.children ? (
						<NavigationMenuItem key={item.title}>
							<NavigationMenuTrigger className={cn(active && "bg-accent/50")} {...clickOnly}>
								{Icon && <Icon className="mr-2 size-4" />}
								{item.title}
							</NavigationMenuTrigger>
							<NavigationMenuContent {...clickOnly}>
								<DropdownItems items={item.children} />
							</NavigationMenuContent>
						</NavigationMenuItem>
					) : (
						<NavigationMenuItem key={item.title}>
							<NavigationMenuLink asChild active={isUnder(pathname, item.path!)} className={navigationMenuTriggerStyle()}>
								<Link to={item.path!}>
									<span className="flex items-center">
										{Icon && <Icon className="mr-2 size-4" />}
										{item.title}
									</span>
								</Link>
							</NavigationMenuLink>
						</NavigationMenuItem>
					);
				})}
			</NavigationMenuList>
		</NavigationMenu>
	);
}

/** A group's pages; a nested group shows as a heading over its own. */
function DropdownItems({ items }: { items: AdminNavItem[] }) {
	const { pathname } = useLocation();
	return (
		<ul className="grid w-56 gap-1">
			{items.map((item) => (
				<li key={item.title}>
					{item.path ? (
						<NavigationMenuLink asChild active={isUnder(pathname, item.path)}>
							<Link to={item.path} className="flex-row items-center gap-2">
								{item.icon && <item.icon />}
								{item.title}
							</Link>
						</NavigationMenuLink>
					) : (
						<div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{item.title}</div>
					)}
					{item.children && (
						<div className="pl-3">
							<DropdownItems items={item.children} />
						</div>
					)}
				</li>
			))}
		</ul>
	);
}
