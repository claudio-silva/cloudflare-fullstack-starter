# Admin lists: `AdminTable`

Every list in the admin area is an `AdminTable`
(`src/react-app/admin/components/AdminTable.tsx`). It holds what the lists
share, so a new page gets the same look and the same features as the others
without rebuilding them:

- a toolbar with the row count, an optional search box and an optional line of
  text (or markup) about the list;
- a `#` column numbering the rows across pages;
- headings that sort on the server, cycling ascending, descending, none;
- a Select toggle, a checkbox per row, "n selected of m", and actions on the
  selection, with a confirmation dialog;
- a ⋮ menu at the end of each row;
- pages, in a footer bar shown when there is more than one;
- a panel of fixed height, with no rows and the message in the middle, while
  the first page loads ("Loading...", with the spinner of the Save buttons), when
  there is nothing to show, and when loading failed (with Try again);
- the area's colours (`admin.css`) and column widths that do not move.

Use it for every list in `/admin`, configured through its props. Build
something else only for a list that genuinely does not fit (a calendar, a
board, a tree), and say why in a comment. The app's own pages, outside
`/admin`, are not bound by it.

It is in the admin area, so `npm run admin:remove` deletes it with the rest.

## The smallest list

```tsx
import { AdminPage } from "../components/AdminPage";
import { AdminTable, type AdminColumn } from "../components/AdminTable";

type Order = { id: string; number: string; customer: string; total: number; createdAt: string };

const COLUMNS: AdminColumn<Order>[] = [
	{ id: "number", header: "Order", sortable: true, width: 120 },
	{ id: "customer", header: "Customer", sortable: true },
	{ id: "total", header: "Total", sortable: true, width: 120, align: "right", cell: (o) => formatMoney(o.total) },
	{ id: "createdAt", header: "Placed", sortable: true, width: 120, muted: true, cell: (o) => formatDate(o.createdAt) },
];

export function Orders() {
	return (
		<AdminPage title="Orders">
			<AdminTable<Order> url="/api/admin/orders" columns={COLUMNS} noun={["order", "orders"]} search="Search orders" rowHref={(o) => `/admin/orders/${o.id}`} />
		</AdminPage>
	);
}
```

That is a complete page: search, sorting, pages, numbering, loading and empty
states. Search, sort and page are kept in the URL, so coming back from an
order brings the list back as it was.

## What the endpoint answers

```
GET /api/admin/orders?page=2&pageSize=20&q=smith&sort=total&dir=desc
→ { "items": [ … ], "total": 134, "page": 2, "pageSize": 20 }
```

- `q` only when there is a search, `sort` and `dir` only while a column sorts.
  With no `sort`, the server uses its own default order.
- `sort` is the column's `id` (or its `sortKey`). The server must check it
  against a list of the columns it can sort, as `src/worker/routes/admin/users.ts`
  does; never put it in SQL unchecked.
- Rows under another key: `rows={(data) => data.orders}`, with the response type
  as the second type parameter, `AdminTable<Order, OrderList>`.
- A row is identified by its `id`; `rowKey` when it is something else.
- `params` adds fixed parameters, e.g. a filter or `locale` (the activity list
  sends it so the server sorts country names in the page's language).

Sort and page on the server, not in the browser, so the list stays one query
and one page however many rows there are. `users.ts` shows how: every sortable
column is an `ORDER BY`, with empty values last in either direction.

## Columns

| Prop | Default | |
|---|---|---|
| `id` | required | Unique; the sort key; and the property shown when there is no `cell` |
| `header` | required | The heading's text or markup |
| `cell` | the property `id`, "—" when empty | `(row) => ReactNode` |
| `sortable` / `sortKey` | not sortable / `id` | Sort on the server by this key |
| `width` | takes the room left | Fixed width in px. Give one to every column but one, sized to its widest content: a cut date is a bug |
| `hideBelow` | always shown | `"sm" \| "md" \| "lg" \| "xl"`: hidden on narrower screens. Hide secondary columns first |
| `muted` | false | Grey text, for secondary values (dates, durations) |
| `align` | `"left"` | `"right"` for numbers and amounts |
| `wrap` | false | Cells are one line with an ellipsis; `wrap` lets the text take several |
| `title` | none | `(row) => string`: a tooltip, e.g. the full value behind a shortened one |
| `className` | none | Extra classes on the heading and the cells |

A `cell` can hold anything: the users list shows an avatar with the name and
email (`UserList.tsx`), the activity list a badge with a detail beside it
(`UserActivity.tsx`).

## The table

| Prop | Default | |
|---|---|---|
| `url` | required | The list endpoint |
| `columns` | required | See above |
| `noun` | `["record", "records"]` | Used in the count, the messages and the dialogs: give it |
| `search` | no search box | The box's placeholder; the text goes to the server as `q` |
| `intro` | nothing | Text or markup in the toolbar, beside the search box or in its place |
| `pageSize` | 20 | Rows per page. D1 binds at most 100 parameters per query, so keep pages modest |
| `state` | `"url"` | `"local"` for a list that is part of another page (a tab, a panel): two lists on one page must not share the URL's `q`, `page` and `sort` |
| `ordinal` | true | The `#` column |
| `rowHref` | rows do nothing | Where a click on a row leads |
| `onRowClick` | | What a click does, when it is not a link |
| `rowActions` | no menu | `(row) => RowAction[]`: the ⋮ menu |
| `deletable` | no deleting | Adds Delete to the row menu and to the selection (see below) |
| `bulkActions` | none | Actions on the selected rows; any of these, or `deletable`, shows the Select toggle |
| `empty` | built from `noun` | The message when there are no rows: markup, or `(q) => markup` to word a fruitless search apart |
| `reloadKey` | | Change it to load again, e.g. after something outside the table changed the data |

## Actions

**Deleting** is built in, because nearly every list needs it:

```tsx
deletable={{
	url: (id) => `/api/admin/orders/${id}`,
	description: "The order and its invoices are removed. This cannot be undone.",
}}
```

The rows go one `DELETE` at a time, so the server's rules apply to each (the
users list refuses to delete yourself or the last admin, row by row). A list
with a bulk endpoint passes `run: (ids) => …` instead of `url`. After it, a toast
says how many went, the selection ends and the list reloads.

**Row menu** entries:

```tsx
rowActions={(order) => [
	{ label: "Resend invoice", icon: Mail, onSelect: (o) => http(`/api/admin/orders/${o.id}/resend`, { method: "POST" }) },
	{ label: "Cancel", icon: Ban, destructive: true, confirm: { title: "Cancel this order?", action: "Cancel order" }, onSelect: cancel },
]}
```

**Bulk** actions:

```tsx
bulkActions={[
	{ label: "Mark shipped", icon: Truck, run: (ids) => http("/api/admin/orders/ship", { method: "POST", body: JSON.stringify({ ids }) }) },
]}
```

An action that returns a promise reloads the list when it settles; one that
asks for `confirm` opens the dialog first, and `destructive` makes it red.
Errors need no handling: the HTTP layer shows them (see `docs/MECHANISMS.md`,
*The HTTP layer*), and the list reloads to show what did happen.

## Loading and empty states

While the first page loads, the table shows its headings over a panel of fixed
height with the spinner and "Loading..." in the middle; no placeholder rows, so
nothing jumps when the data arrives. Later loads (another page, a sort, a
search) keep the rows on screen, dimmed, until the new ones are in. With no
rows, the same panel holds the `empty` message; if the first load failed, it
offers Try again (the HTTP layer has already said what went wrong).

## Changing how every list looks

Colours are the area's variables in `src/react-app/admin/admin.css`
(`--admin-toolbar`, `--admin-table-head`, `--admin-table-foot`); the row-number
column is `ORDINAL` in `styles.ts`; the panel's height is `PANEL_HEIGHT` in
`AdminTable.tsx`. Change them there and every list follows. A change one list
needs and the others do not is a prop; if the prop does not exist, add it to
`AdminTable` (with a default that keeps the other lists as they are) rather
than copying the component.

The texts are English, like the rest of the area.
