# The admin area

An example backoffice at `/admin`: one way to lay out an administration area,
for you to keep, restyle or delete. The starter does not impose a design
elsewhere, and does not mean to here. A project's backoffice depends on
what the project needs, so treat this one as a starting point.

What it shows:

- **Access by role.** Only admins and superadmins can open it. Anyone else gets
  a 403, both on the pages and on the API.
- **The usual frame.** A hierarchical menu, then each page's breadcrumbs and
  title, its content, and a footer at the bottom.
- **A CRUD section.** User management, superadmins only. A list with search,
  sorting and pages; clicking a row opens a detail form that creates, updates
  and deletes.

It is built only from the shadcn/ui components the starter already has
(`sidebar`, `navigation-menu`, `breadcrumb`, `table`, `pagination`, `form`,
`alert-dialog`, …), and adds no dependency.

## Contents

- [Roles](#roles)
- [Files](#files)
- [Choosing the menu: sidebar or top bar](#choosing-the-menu-sidebar-or-top-bar)
- [Colours and buttons](#colours-and-buttons)
- [Adding a page](#adding-a-page)
- [The user management example](#the-user-management-example)
- [Removing it](#removing-it)

## Roles

Roles are listed in `src/shared/roles.ts`, lowest first. Each role includes
the ones below it:

| Role | Can |
|---|---|
| `user` | Use the app (default) |
| `admin` | Also open the admin area |
| `superadmin` | Also manage users |

`hasRole(role, "admin")` means "admin or higher", in the Worker, the browser
and the CLI alike. To add a role, put it in the list at its rank. `users.role`
is a plain string, so no migration is needed.

The role is part of the session, which Better Auth reads from the database on
every request (`user.additionalFields` in `src/worker/middleware/auth.ts`). So
a role change applies to the user's next request, and a change that takes
access away also signs them out everywhere. The menu item and the pages only
*show* what the role allows; the Worker is what enforces it.

The first superadmin comes from the CLI:

```bash
npm run auth set-role -- -u you@example.com -r superadmin
```

## Files

| Where | What |
|---|---|
| `src/react-app/admin/config.ts` | Default menu style, menu tree, and each item's minimum role |
| `src/react-app/admin/AdminRoutes.tsx` | The routes under `/admin`; mounted in `App.tsx` |
| `src/react-app/admin/nav.ts` | Menu helpers: what a role sees, the current page's trail, the menu style chosen |
| `src/react-app/admin/admin.css` | The area's colours, light and dark |
| `src/react-app/admin/styles.ts` | Shared classes, such as the action buttons' width |
| `src/react-app/admin/components/` | `AdminLayout` (frame and footer), `AdminSidebar`, `AdminTopNav`, `AdminPage` (breadcrumbs and title), 403/404 |
| `src/react-app/admin/pages/` | `Dashboard`, `users/UserList`, `users/UserForm` |
| `src/worker/routes/admin/` | The API, `/api/admin/*`: admins and up; `users.ts` superadmins only |
| `src/shared/admin-users.ts` | The users API's validation (zod) and types, shared by the Worker and the form |
| `test/admin.test.ts` | Access by role, and the CRUD example |

These stay if you remove the area, because other code uses them:
`src/shared/roles.ts`, `src/worker/middleware/roles.ts` (`requireRole()`), and
`src/worker/lib/users.ts` (user writes shared with the auth CLI).

## Choosing the menu: sidebar or top bar

The toggle at the top right of the dashboard switches between them. The choice
is kept in the browser (`localStorage`), so it is per browser, not per user.
The default, until someone chooses, is in `src/react-app/admin/config.ts`:

```ts
navigation: "sidebar", // or "topbar"
```

To fix the style and drop the toggle, remove the `ToggleGroup` from
`pages/Dashboard.tsx`.

- **`sidebar`**: a vertical menu below the app's header, using shadcn's
  `Sidebar`. It collapses to icons (the button by the breadcrumbs, or
  Ctrl/⌘+B), groups expand in place, and on small screens it becomes a sheet.
- **`topbar`**: a horizontal bar below the header, using shadcn's
  `NavigationMenu`. Each group is a dropdown of its pages.

Both read the same `nav` tree. Breadcrumbs come from it too: "Admin" first,
then the path through the menu to the current page. A page can add crumbs of
its own, as the user form does with the user's name.

## Colours and buttons

The area sets its own colours in `src/react-app/admin/admin.css`, scoped to it,
so the rest of the app keeps the starter's theme. In light mode:

| Part | Colour |
|---|---|
| Sidebar, white text and icons | `#333` |
| The current page's item (bold) | `#444` |
| Page background, outside the cards | `#f8f8f8` |
| Page footer | `#f4f4f4` |
| A list's search bar (the input stays white) | `#f4f4f4` |
| A list's column headings | `#fafafa` |
| A list's pagination bar | `#f6f6f6` |

Dark mode has its own values in the same file. Change a colour there, not in
the pages.

Action buttons (Save, New, Cancel, Delete, Back) have icons and one width,
`ACTION_BUTTON` in `styles.ts`. While saving, a spinner takes the place of the
Save icon.

## Adding a page

1. Add the page under `src/react-app/admin/pages/` and wrap its content in
   `AdminPage`:

   ```tsx
   export function Orders() {
     return (
       <AdminPage title="Orders" description="…" actions={<Button>New order</Button>}>
         …
       </AdminPage>
     );
   }
   ```

2. Add its route in `AdminRoutes.tsx` (`<Route path="orders" element={<Orders />} />`).
3. Add it to `nav` in `config.ts`, inside a group or at the top level. A
   `minRole` on the item, or on a group above it, hides it from lower roles
   and shows them a 403 if they open the URL anyway.
4. For its API, add a module beside `src/worker/routes/admin/users.ts` and
   mount it in `src/worker/routes/admin/index.ts`. Everything there already
   requires admin; a section that needs more adds
   `.use("*", requireRole("superadmin"))`.

The client-side role check only decides what the browser shows. Every admin
endpoint has to check the role itself.

## The user management example

`/admin/users` lists users 20 at a time. The search, sort and page live in
the URL, so returning from a user's page brings back the same list. Clicking a
row opens `/admin/users/:id`; **New user** opens `/admin/users/new`.

The form and the API validate with the same schemas (`src/shared/admin-users.ts`).
It shows the [HTTP layer](MECHANISMS.md#the-http-layer) in use: failures are
shown by the layer, except the 409 for an email already in use, which the form
takes (`handles: [409]`) and shows next to the field.

The list has a row-number column, and a **Select** toggle in its toolbar that
adds a checkbox column (with select-all in the heading) and enables **Delete**
for the selected rows. Saving the form returns to the list.

Rules the API enforces:

- A superadmin cannot change their own role, deactivate themselves or delete
  themselves here (their profile page deletes their account).
- The last user who can open the admin area cannot be demoted or deleted.
- Setting a password, lowering a role or deactivating signs the user out
  everywhere.
- In [demo mode](MECHANISMS.md#demo-mode), every write is refused, as everywhere else.

"Active" is `emailVerified`, the same flag `npm run auth activate-user` sets.
While email verification is required, an unverified user cannot sign in.

### Status

The list's **Status** column says what the user is doing now, from their
sessions (`userStatus()` in `src/shared/admin-users.ts`):

| Status | When |
|---|---|
| Active (green dot) | in session, last seen less than 5 minutes ago |
| Idle (grey dot) | in session, last seen 5 minutes ago or more |
| Disabled (red dot) | not `emailVerified`; wins over the other two |
| — (no pill) | no live session |

The column sorts too (active, idle, signed out, disabled), as does **Last sign-in**. Both come from the sessions and the log, not from a column, so those sorts are done in the Worker over everyone who matches the search, then paged.

Every sortable heading cycles through three states: ascending, descending, and no sort (back to newest first, with no arrow). The **Idle** column is the time since the user's latest session was used.

The Activity tab's **Browser** column is `describeBrowser()` (`src/shared/admin-users.ts`), a small User-Agent reading ("Chrome · Desktop"; Mobile and Tablet too). It is deliberately not a library or a fingerprint: an iPad in desktop mode reports itself as a Mac. If you need exact devices, record what the page knows (`navigator.userAgentData`, `maxTouchPoints`) in a header of the sign-in request and store it in `login_events`.

"Last seen" is the latest `sessions.updatedAt` of the user's unexpired sessions.
Better Auth touches it at most once per `session.updateAge`, which the starter
sets to 60 seconds (`middleware/auth.ts`), so idle time is accurate to about a
minute, at the price of one small write per active session per minute.

### The user page

Two tabs. **Profile** has the form (the password is typed twice) and a panel
with the status, in-session flag, idle time, last sign-in and last sign-out.
**Activity** pages through the sign-ins, failed attempts and sign-outs from
`login_events` (`GET /api/admin/users/:id/activity?page=&pageSize=`), 10 a
page, in a table styled like the user list; they are pruned after `AUTH_LOG_RETENTION_DAYS`. Sign-outs are
recorded since migration `0006_login_event_kind`; earlier rows are sign-ins.

## Removing it

Commit first, then:

```bash
npm run admin:remove                 # or pnpm run admin:remove; asks before changing anything
npm run admin:remove -- --dry-run    # only lists what it would do
```

`bin/remove-admin.ts` deletes the area's own files (`src/react-app/admin/`,
`src/worker/routes/admin/`, `src/shared/admin-users.ts`, `test/admin.test.ts`,
this file and itself) and strips what the area added to shared files. Those
additions are marked: a block from a line containing `[admin-area]` to one
containing `[/admin-area]`, or a single line containing `[admin-area-line]`.
It also removes its own `admin:remove` script from `package.json`. If a marker
does not pair up, it changes nothing. Afterwards it lists any line that still
mentions the area.

Mark anything you add to a shared file for the admin area the same way, and the
command removes it too.

Roles, `requireRole()` and the role in the session stay, for whatever you build
instead. A later starter upgrade (UPGRADING.md) may bring the area back; run the
command again.
