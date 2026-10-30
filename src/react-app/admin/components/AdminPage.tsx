import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { adminConfig } from "../config";
import { useNavTrail, useNavigationMode } from "../nav";

export type Crumb = { title: string; path?: string };

type AdminPageProps = {
	title: string;
	description?: ReactNode;
	/** Buttons on the right of the title. */
	actions?: ReactNode;
	/** Appended to the ones the menu gives, e.g. the record a detail page shows. */
	breadcrumbs?: Crumb[];
	children: ReactNode;
};

/** A page of the admin area: breadcrumbs, title, then the content. */
export function AdminPage({ title, description, actions, breadcrumbs = [], children }: AdminPageProps) {
	const mode = useNavigationMode();
	const trail = useNavTrail().filter((item) => item.path !== adminConfig.root.path);
	const crumbs: Crumb[] = [adminConfig.root, ...trail, ...breadcrumbs];

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:px-8">
			<header className="space-y-3">
				<div className="flex items-center gap-2">
					{mode === "sidebar" && (
						<>
							<SidebarTrigger className="-ml-1" />
							<Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
						</>
					)}
					<Breadcrumb>
						<BreadcrumbList>
							{crumbs.map((crumb, i) => {
								const last = i === crumbs.length - 1;
								return (
									<Fragment key={`${crumb.path ?? ""}:${crumb.title}`}>
										<BreadcrumbItem>
											{last ? (
												<BreadcrumbPage>{crumb.title}</BreadcrumbPage>
											) : crumb.path ? (
												<BreadcrumbLink asChild>
													<Link to={crumb.path} className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
														{crumb.title}
													</Link>
												</BreadcrumbLink>
											) : (
												<span>{crumb.title}</span>
											)}
										</BreadcrumbItem>
										{!last && <BreadcrumbSeparator />}
									</Fragment>
								);
							})}
						</BreadcrumbList>
					</Breadcrumb>
				</div>
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div className="min-w-0 space-y-1">
						<h1 className="truncate text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
						{description && <p className="text-sm text-muted-foreground">{description}</p>}
					</div>
					{actions && <div className="flex items-center gap-2">{actions}</div>}
				</div>
			</header>
			<div className="flex flex-1 flex-col">{children}</div>
		</div>
	);
}
