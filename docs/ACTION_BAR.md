# Action buttons: `ActionBar`

Every form and list has the same handful of actions: create, save, cancel, go
back, delete, print. `src/react-app/components/actions/` gives each one a
button that already knows its icon, label, colour and behaviour, so that every
page looks and behaves the same. The admin area uses them, and the app's own
pages can too.

```tsx
import { ActionBar, ButtonCancel, ButtonDelete, ButtonPrint, ButtonSave, useRecordForm } from "@/components/actions";

const record = useRecordForm({ form, onSave, deleteUrl: `/api/authors/${id}` });

<form {...record.formProps}>…</form>
<ActionBar record={record} className="action-bar-fixed">
	<ButtonCancel />
	<ButtonDelete message={`Delete ${author.name}?`} />
	<ButtonPrint onClick={() => printAuthor(id)} />
	<ButtonSave />
</ActionBar>
```

## Contents

- [The bar](#the-bar)
- [The buttons](#the-buttons)
- [Connecting a form: `useRecordForm`](#connecting-a-form-userecordform)
- [`onClick`: before, instead of, or cancelling the action](#onclick-before-instead-of-or-cancelling-the-action)
- [Events and toasts](#events-and-toasts)
- [Colours and width](#colours-and-width)

## The bar

`ActionBar` is a right-aligned row of buttons. Its look comes from classes in
`src/react-app/index.css`:

| Class | Look |
|---|---|
| none | A rule (top border) above the buttons, padding, and space above the rule to set it apart from the content before it. No background |
| `action-bar-fixed` | The same, and it stays at the bottom of the viewport while the page scrolls, coming to rest above the footer at the end. While it floats over the page it gets a background (`ActionBar` sets `data-stuck` on it) |
| `action-bar-unstyled` | No rule, padding or margin: for a bar inside something else |

- **In a page's header**: `<AdminPage actions={<ActionBar className="action-bar-unstyled">…</ActionBar>}>`.
  The header lines it up with the title.
- **Under a form or a list**: no class, or `action-bar-fixed` for one taller
  than the screen.

`action-bar-fixed` is `position: sticky`, so it keeps to its column (beside a
sidebar, say), and it takes its own place at the end of the content, so the
page needs no padding for it: scrolled to the end, nothing is hidden under it.
It has to be the last element of its container; anything after it would pass
under it while it floats.

The same `record` can feed two bars at once (one in the header, one at the
bottom).

## The buttons

| Button | Colour | Does |
|---|---|---|
| `ButtonNew` | success (green) | For lists: opens the detail page without an id, `to` (default: this path + `/new`). A link, so it opens in a new tab too |
| `ButtonSave` | primary | Enabled only while the form is dirty. Validates and saves it. Enter in a field presses it |
| `ButtonCancel` | normal | Dirty: says **Cancel** (×) and asks *Save your changes?* (Keep editing, Discard, Save), then goes back. Clean: says **Back** (◀) and goes back |
| `ButtonBack` | normal | Goes back (←), without looking at any form. `to` goes there instead |
| `ButtonDelete` | danger (red) | Asks first (`title`, `message`), unless `confirm={false}`; sends `DELETE` to `url` (default: the record's `deleteUrl`), then goes back. Disabled without a URL |
| `ButtonPrint` | normal | Only calls `onClick`; enabled once the record is saved, that is when it has an id |

Every button takes `label` and `icon` (an element, or `null` for none), and
anything a `Button` takes (`className`, `disabled`, `size`…). `ButtonCancel`
also takes `backLabel` and `backIcon` for its clean state.

"Goes back" is `history.back()`, unless the page was the first one the app
opened (a link from elsewhere, a reload); then it goes to `backTo`, or to the
parent path (`/authors/123` → `/authors`).

The record id is `useRecordForm`'s `id`, or else the last segment of the URL
when a route parameter matched it: `/authors/123` on `authors/:id` has one,
`/authors/new` has none.

Labels and dialog texts are under `actions.*` in `src/react-app/lib/i18n.ts`.

## Connecting a form: `useRecordForm`

The buttons learn about the form from the `record` given to their bar.
`useRecordForm()` builds it from a react-hook-form form:

```ts
const record = useRecordForm({
	form,
	onSave: async (values) => {
		const res = await http(isNew ? "/api/authors" : `/api/authors/${id}`, { method: isNew ? "POST" : "PATCH", body: JSON.stringify(values) });
		return { id: ((await res.json()) as Author).id };
	},
	deleteUrl: isNew ? undefined : `/api/authors/${id}`,
	backTo: "/authors",   // when there is no previous page to go back to
	afterSave: "stay",    // or "back"
});
```

`onSave` gets the validated values. It returns:

- nothing, or `{ message }` to change the toast's text: saved;
- `{ id }` for a new record: saved, and the page moves to the record's URL
  (`/authors/new` → `/authors/123`), so Print and Delete become available;
- `false`: not saved, because the page dealt with it (an error shown next to a
  field, say).

Errors from `http()` need no handling: the HTTP layer has shown them, and the
form stays as it was. After a save, the form is no longer dirty; with
`afterSave: "back"` the page goes back, as the user form does.

`record.formProps` (`id`, `onSubmit`) goes on the `<form>`. The Save button
submits that form wherever it is, so the bar need not be inside it.

A page without react-hook-form passes its own object instead:
`<ActionBar record={{ dirty, saving, id, save, deleteUrl }}>`; see
`RecordScope` in `record.ts`. Without any `record`, Save is an ordinary
submit button of the form it sits in, and Cancel is always Back.

## `onClick`: before, instead of, or cancelling the action

A button's `onClick` runs before its own action, and may return a promise:

| Returns | The button's action |
|---|---|
| `true` | goes ahead |
| `false` | is cancelled |
| nothing (`undefined`) | is replaced: the handler did the job |

```tsx
<ButtonCancel label="Give up" icon={<Flag />} onClick={() => window.confirm("Sure?")} />
<ButtonSave onClick={async () => (await checkStock()) ? true : false} />
```

## Events and toasts

When an action is done, the button announces it as a global event:

| Event | When | Default |
|---|---|---|
| `created` | a new record was saved | success toast, "Created." |
| `saved` | a record was saved | info toast, "Saved." |
| `deleted` | a record was deleted | info toast, "Deleted." (red is for errors) |
| `discarded` | Cancel → Discard | warning toast, "Changes discarded." |
| `new`, `back` | New, Back, or Cancel on a clean form | nothing |

Changing them, usually once in `main.tsx`:

```ts
import { setActionEvents, setActionHandler } from "@/components/actions";

setActionEvents(false);                                   // none at all
setActionHandler("saved", (d) => myNotify(d.message));    // replace one default
setActionHandler("deleted", null);                        // silence one
setActionHandler("deleted", undefined);                   // its default again
```

Each event is also dispatched on `window` as `app:action` (`detail`:
`{ action, id, message }`) before its handler runs. Listen to it to log or
sync something; `preventDefault()` skips the handler for that one event.

## Colours and width

The colours are theme variables in `src/react-app/index.css`: `--primary`,
`--destructive` (danger) and the status colours `--success`, `--warning`,
`--info`, light and dark, used as `bg-success`, `text-warning` and so on.
`ButtonNew` uses the `success` variant of `Button` (a `// project:` addition
to `components/ui/button.tsx`).

The buttons share one minimum width, `--action-button-w` (as wide as the label
when unset). The admin area sets it to `10rem` (`admin.css`), the width of its
other action buttons.
