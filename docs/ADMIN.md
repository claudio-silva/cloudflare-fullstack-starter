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
  Ctrl/⌘+B), groups expand in place, and on small screens (under 768px) it
  becomes a sheet. It also follows the window: narrowed below
  `sidebarExpandedFrom` (1024px, in `config.ts`) it collapses to icons, and
  widened past it, it expands again.
- **`topbar`**: a horizontal bar below the header, using shadcn's
  `NavigationMenu`. Each group is a dropdown of its pages, opened by a click,
  not by hovering.

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

Two things here are app-wide rather than the area's: outline buttons (Cancel,
Back, Select) are a light grey, `--button-outline`, whose border darkens on
hover (`--button-outline-border-hover`), in `src/react-app/index.css`, and sections are `Panel`s with a coloured header
band (see [Panels](#panels)). Both stay if the area is removed.

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

- A superadmin cannot change their own role, disable themselves or delete
  themselves here (their profile page deletes their account).
- The last user who can open the admin area cannot be demoted, disabled or deleted.
- Setting a password, lowering a role or disabling signs the user out
  everywhere.
- In [demo mode](MECHANISMS.md#demo-mode), every write is refused, as everywhere else.

### Enabled and Verified

Two separate switches:

- **Enabled** (`users.disabled`, migration 0007) decides whether the user can
  sign in at all. A disabled account is refused at sign-in with a message
  (password) or gets no session (Google, email links), and disabling ends its
  sessions. From the terminal: `npm run auth enable-user -- -u <email> -s off`.
- **Verified** is Better Auth's `emailVerified`: the address is confirmed, by
  the emailed link, by Google, or by an admin here (or `npm run auth
  activate-user`). While email verification is required, an unverified user
  cannot sign in either.

### Accounts that sign in with Google

Nothing in the form assumes a password. The panel lists the sign-in methods
(**Password**, **Google**); the avatar is the picture Google gave
(`users.image`); the Verified switch says that Google confirms the address.
For an account with no password, the Password panel says so, and setting one
there adds email-and-password sign-in beside Google (`setPassword()` creates
the credential account). On their own profile page, such users are pointed to
"Forgot password", whose link does the same. The Activity tab shows how each
sign-in authenticated.

### Status

The list's **Status** column says what the user is doing now, from their
sessions and the two switches (`userStatus()` in `src/shared/admin-users.ts`):

| Status | When |
|---|---|
| Active (green dot) | in session, last seen less than 5 minutes ago |
| Idle (grey dot) | in session, last seen 5 minutes ago or more |
| Unverified (amber dot) | no session, and the address is not confirmed |
| Disabled (red dot) | not enabled; wins over everything else |
| — (no pill) | no live session |

### Columns and sorting

Besides name, role and creation date, the list shows **Status**, **Last
sign-in**, **Idle** (time since the latest session was used) and **Usage**
(total time in session). Every one of them sorts, in SQL: the query joins
`users` to its live sessions and to `user_stats`, so a sort over thousands of
users is still one query and one page. Status sorts active, idle, unverified,
disabled. Empty values ("—") always come last, in either direction, and every
heading cycles through ascending, descending and no sort (newest first). A page
holds at most 50 users: D1 binds at most 100 parameters per query.

Usage is the sum of every session's length, kept in `user_stats` as each
session ends, plus the open ones so far: from sign-in to sign-out, or to the
last use when the session expired or was revoked (see
[Sign-in log](MECHANISMS.md#sign-in-log)). Sessions open at the same time on
two devices both count.

Sessions expire after 24 hours without use (`session.expiresIn` in
`middleware/auth.ts`); each use, at most once a minute, pushes the expiry a day
ahead, so someone working in the app stays signed in. An absolute 24 hours from
sign-in would need `disableSessionRefresh`, which would also stop "last seen"
from updating. "Last seen" is the latest `sessions.updatedAt` of the user's
unexpired sessions, accurate to about a minute (`session.updateAge` is 60
seconds), at the price of one small write per active session per minute.

### The user page

Two tabs. **Profile** has the form (the password is typed twice) and a panel:
a header with the avatar, name, role and status, then the dates, sign-in
methods, last sign-in and sign-out, number of sign-ins (and failed ones), time
in session and, while the user is in session, the idle time and the IP address
and country of the session used last. **Sign out everywhere** ends every
session at once (`POST /api/admin/users/:id/sign-out`; each is logged as
revoked, by you). The IP comes from the session; `sessions` keeps no country,
so that is the one of the latest sign-in. Countries are stored as ISO codes
(Cloudflare's `cf.country`, empty locally) and shown by name through
`countryName()` (`lib/countries.ts`), which uses the browser's
`Intl.DisplayNames` in the app's language (`getLocale()` / `setLocale()` in
`lib/i18n.ts`), so a translation needs nothing more.

**Activity** (with the number of entries beside its name, when not zero) pages
through the user's history in `login_events`
(`GET /api/admin/users/:id/activity?page=&pageSize=&sort=&dir=`), 10 a page:
sign-ins with their method, failed attempts, sign-outs, and sessions that
**expired** or were **revoked**, each ending with its length, and for a
revocation by someone else, who. The columns sort like the list's. Newest first
is a page of an indexed query; other sorts read the user's history, because the
browser and the country name are worked out when shown. Deleting a user adds a
`user-deleted` row with who deleted them; it never shows here, because the user
is gone.

The **Browser** column is `describeBrowser()` (`src/shared/admin-users.ts`), a
small User-Agent reading ("Chrome · Desktop"; Mobile and Tablet too). It is
deliberately not a library or a fingerprint: an iPad in desktop mode reports
itself as a Mac. If you need exact devices, record what the page knows
(`navigator.userAgentData`, `maxTouchPoints`) in a header of the sign-in
request and store it in `login_events`.

### Panels

Sections are `Panel`s (`src/react-app/components/Panel.tsx`, shared with the
profile page): a `Card` with a coloured header band, `strong` (dark) for a
title, `soft` (light) for a summary like the user's, `danger` for deletion. The
colours are theme variables in `src/react-app/index.css` (`--panel-header*`),
next to `--button-outline*`, the light grey of outline buttons, and
`--color-danger` (maroon), shared by the Delete panels and the lost-connection
banner.

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
