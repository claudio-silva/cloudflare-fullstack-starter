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
states. Search, sort and page are kept in the URL (`/admin/orders?p=2&q=smith&s=-total`),
so coming back from an order brings the list back as it was.

## What the endpoint answers

Every list speaks the same protocol (`src/shared/admin-list.ts`):

```
GET /api/admin/orders?p=2&ps=20&q=smith&s=-total
→ { "items": [ … ], "total": 134 }
```

| Parameter | |
|---|---|
| `p` | The page, from 1 |
| `ps` | Rows per page |
| `q` | The search, only when there is one |
| `s` | The sort, only while a column sorts: the column's `id` (or `sortKey`), descending with a leading `-`. Without it the server uses its own order |

The server reads them with `parseListQuery`, which also checks the sort
against the columns it can sort, so the value that reaches the query is one of
them or `null`; never put an unchecked one in SQL:

```ts
import { parseListQuery } from "../../../shared/admin-list";

const ORDER_SORTS = ["number", "customer", "total", "createdAt"] as const;

orders.get("/", async (c) => {
	const { page, pageSize, q, sort, dir } = parseListQuery((name) => c.req.query(name), { sortable: ORDER_SORTS, maxPageSize: 50 });
	// … WHERE for q, ORDER BY sort ?? "createdAt", LIMIT pageSize OFFSET (page - 1) * pageSize
	return c.json({ items, total });
});
```

- Rows under another key: `rows={(data) => data.orders}`, with the response type
  as the second type parameter, `AdminTable<Order, OrderList>`; a total under
  another key: `total={(data) => data.count}`.
- A row is identified by its `id`; `rowKey` when it is something else.

Sort and page on the server, not in the browser, so the list stays one query
and one page however many rows there are. `src/worker/routes/admin/users.ts`
shows how: every sortable column is an `ORDER BY`, with empty values last in
either direction.

## Extending or replacing the protocol

Each step keeps the whole table (toolbar, selection, actions, states) and
changes only where the rows come from:

| Need | Use |
|---|---|
| More criteria: an advanced search form, a filter, the locale | `params={{ status, from, to }}`: added to every request; a change loads again. Reset the page when they change (below) |
| An endpoint that speaks another protocol (`offset`/`limit`, `sort`/`order`) | `queryParams={(list) => ({ offset: String((list.page - 1) * list.pageSize), limit: String(list.pageSize) })}`: replaces `p`, `ps`, `q`, `s`; `params` are still added |
| Another kind of request (GraphQL, an RPC, a POST with a body) | `load={(list) => fetchOrders(list)}`: returns the response; the table still shows loading, failures and Try again. Called again when the state, `params` or `reloadKey` change |
| Rows that arrive by themselves (a websocket, a shared store) | No `url` or `load`: pass `data` (null until there is some), and `loading`, `failed`, `onReload` if they apply |

`list` in `queryParams` and `load` is the list's state, `{ page, pageSize, q, sort, dir }`.

### Reading or changing the state outside the table

`useAdminList()` (`src/react-app/admin/use-admin-list.ts`) holds the state the
table would otherwise keep inside: in the address (`state: "url"`, default) or
in the page (`"local"`). Give it to the table as `list` and the page can read
it, change it, or load with it:

```tsx
const list = useAdminList({ pageSize: 50 });
const [filters, setFilters] = useState<OrderFilters>({});

<OrderFilterForm
	onSubmit={(next) => {
		setFilters(next);
		list.update({ page: 1 });
	}}
/>
<AdminTable<Order> url="/api/admin/orders" params={filters} list={list} columns={COLUMNS} noun={["order", "orders"]} search="Search orders" />
```

With rows pushed from elsewhere, the page subscribes with the state and hands
the result over:

```tsx
const list = useAdminList({ state: "local" });
const { page, pageSize, q, sort, dir } = list;
const [data, setData] = useState<ListResponse<Order> | null>(null);
useEffect(() => ordersSocket.subscribe({ page, pageSize, q, sort, dir }, setData), [page, pageSize, q, sort, dir]);

<AdminTable<Order> data={data} list={list} columns={COLUMNS} noun={["order", "orders"]} search="Search orders" />
```

`list.update({ … })` changes any of `page`, `pageSize`, `q`, `sort`, `dir`; a
new search, sort or page size goes back to page 1 unless `page` is given too.
The table checks `sort` against its sortable columns before using it.

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
| `url` | | The list endpoint, asked with the protocol above |
| `params` | none | Added to every request's query |
| `queryParams` / `load` / `data` | | Replace the query, the request, or the request altogether: *Extending or replacing the protocol* |
| `rows` / `total` | `data.items` / `data.total` | Take the rows and the total out of the response |
| `list` | the table's own | The state from `useAdminList`, when the page needs it |
| `columns` | required | See above |
| `noun` | `["record", "records"]` | Used in the count, the messages and the dialogs: give it |
| `search` | no search box | The box's placeholder; the text goes to the server as `q`. A change of `q` from outside shows in the box |
| `intro` | nothing | Text or markup in the toolbar, beside the search box or in its place |
| `pageSize` | 20 | Ignored with `list`. Rows per page. D1 binds at most 100 parameters per query, so keep pages modest |
| `state` | `"url"` | Ignored with `list`. `"local"` for a list that is part of another page (a tab, a panel): two lists on one page must not share the address's `p`, `q` and `s` |
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
