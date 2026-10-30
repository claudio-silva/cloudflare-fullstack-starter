import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SortDir } from "../sort";

type SortHeaderProps<F extends string> = { field: F; sort: F | null; dir: SortDir; onSort: (field: F) => void; children: ReactNode };

/** A column heading that sorts: a button with an arrow showing the state. */
export function SortHeader<F extends string>({ field, sort, dir, onSort, children }: SortHeaderProps<F>) {
	const Icon = sort !== field ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
	return (
		<Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => onSort(field)}>
			{children}
			<Icon className={sort === field ? "" : "text-muted-foreground/60"} />
		</Button>
	);
}
