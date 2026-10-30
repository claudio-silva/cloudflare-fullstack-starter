import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Header colours: theme variables in index.css. */
const TONES = {
	/** A titled section: dark band, light text. */
	strong: "bg-panel-header text-panel-header-foreground",
	/** A summary at the top of a panel (who the user is): a light band. */
	soft: "border-b border-panel-header-soft-border bg-panel-header-soft text-foreground",
	/** Something that cannot be undone. */
	danger: "bg-danger text-white",
} as const;

type PanelProps = {
	/** A string becomes the panel's title; anything else is the header's content. */
	title: ReactNode;
	description?: ReactNode;
	tone?: keyof typeof TONES;
	className?: string;
	/** Classes for the wrapper of `children` (a grid of fields, say). */
	bodyClassName?: string;
	children?: ReactNode;
};

/**
 * A card whose header is a coloured band, so a section's title stands apart
 * from its content (shadcn's own card header is plain text on the card).
 * Composed from `Card`, which stays as shadcn ships it.
 */
export function Panel({ title, description, tone = "strong", className, bodyClassName, children }: PanelProps) {
	return (
		<Card className={cn("gap-0 overflow-hidden py-0", className)}>
			<CardHeader className={cn("gap-0 px-6 py-2.5", TONES[tone])}>
				{typeof title === "string" ? <CardTitle className="leading-6">{title}</CardTitle> : title}
			</CardHeader>
			{(description || children) && (
				<CardContent className={cn("pb-6", description ? "pt-3" : "pt-5")}>
					{description && <CardDescription className="mb-5">{description}</CardDescription>}
					<div className={bodyClassName}>{children}</div>
				</CardContent>
			)}
		</Card>
	);
}
