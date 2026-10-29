import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";

/** The bar under a list: "Page x of y" and the page links. `onPage` gets the new page number. */
export function PageBar({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
	const go = (n: number) => (e: { preventDefault: () => void }) => {
		e.preventDefault();
		onPage(n);
	};
	return (
		<div className="flex items-center justify-between gap-4 border-t bg-(--admin-table-foot) px-4 py-2">
			<span className="text-sm text-muted-foreground">
				Page {page} of {pages}
			</span>
			<Pagination className="mx-0 w-auto">
				<PaginationContent>
					<PaginationItem>
						<PaginationPrevious href="#" aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""} onClick={go(page - 1)} />
					</PaginationItem>
					{pageWindow(page, pages).map((n) => (
						<PaginationItem key={n} className="hidden sm:list-item">
							<PaginationLink href="#" isActive={n === page} onClick={go(n)}>
								{n}
							</PaginationLink>
						</PaginationItem>
					))}
					<PaginationItem>
						<PaginationNext href="#" aria-disabled={page >= pages} className={page >= pages ? "pointer-events-none opacity-50" : ""} onClick={go(page + 1)} />
					</PaginationItem>
				</PaginationContent>
			</Pagination>
		</div>
	);
}

/** Up to five page numbers around the current one. */
function pageWindow(page: number, pages: number): number[] {
	const start = Math.max(1, Math.min(page - 2, pages - 4));
	return Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
}
