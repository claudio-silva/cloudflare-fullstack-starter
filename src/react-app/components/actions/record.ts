import { createContext, use, useCallback, useId, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useFormState, type FieldValues, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { isHandledHttpError } from "@/lib/http";
import { t } from "@/lib/i18n";
import { emitAction } from "./events";

/**
 * What the action buttons know about the record on the page. `useRecordForm()`
 * builds it from a react-hook-form form; a page without one can pass an object
 * of its own to `<ActionBar record={…}>`.
 */
export type RecordScope = {
	/** Unsaved changes: enables Save, and makes Cancel ask before leaving. */
	dirty: boolean;
	saving: boolean;
	/** The record's id; `undefined` for one not saved yet. */
	id?: string;
	/** Validates and saves; resolves `true` once saved. `leave` goes back afterwards. */
	save?: (options?: { leave?: boolean }) => Promise<boolean>;
	/** Where ButtonDelete sends its `DELETE`. */
	deleteUrl?: string;
	/** Where Back, Cancel and Delete go when there is no previous page in the app to return to. */
	backTo?: string;
	/** The `id` of the `<form>`, so that Save submits it (and Enter in a field presses Save) from anywhere on the page. */
	formId?: string;
};

export const RecordContext = createContext<RecordScope | null>(null);

export function useRecordScope(): RecordScope | null {
	return use(RecordContext);
}

const parentPath = (pathname: string) => pathname.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/";

/**
 * The record id in the URL: the last segment, when a route parameter matched it
 * (`/authors/123` on `authors/:id`), so `/authors/new` and `/authors` have none.
 */
export function useRouteId(): string | undefined {
	const params = useParams();
	const { pathname } = useLocation();
	const last = decodeURIComponent(pathname.replace(/\/+$/, "").split("/").pop() ?? "");
	if (!last) return undefined;
	return Object.entries(params).some(([key, value]) => key !== "*" && value === last) ? last : undefined;
}

/**
 * `history.back()`, unless this is the first page the app opened (a link from
 * elsewhere, a reload), when there is nowhere in the app to go back to: then
 * `fallback`, or the parent path (`/authors/123` → `/authors`).
 */
export function useGoBack(fallback?: string): () => void {
	const navigate = useNavigate();
	const { pathname } = useLocation();
	return useCallback(() => {
		const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
		if (idx > 0) navigate(-1);
		else navigate(fallback ?? parentPath(pathname));
	}, [navigate, pathname, fallback]);
}

/** `false`: not saved (the page has shown why). An object: the new record's id, and the toast's text. */
export type SaveResult = false | void | { id?: string | number; message?: string };

type RecordFormOptions<TValues extends FieldValues, TOutput> = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	form: UseFormReturn<TValues, any, TOutput>;
	/** The write. Called with the validated values; errors through `http()` need no handling. */
	onSave: (values: TOutput) => Promise<SaveResult> | SaveResult;
	/** Defaults to the id in the URL (`useRouteId()`). */
	id?: string | number;
	deleteUrl?: string;
	backTo?: string;
	/**
	 * After a save: `"stay"` (default) keeps the page, a new record moving to its
	 * own URL (`/authors/new` → `/authors/123`) when `onSave` returns its id;
	 * `"back"` returns to where the user came from.
	 */
	afterSave?: "stay" | "back";
};

/**
 * Connects a react-hook-form form to the action buttons:
 *
 *   const record = useRecordForm({ form, onSave, deleteUrl: `/api/authors/${id}` });
 *   <form {...record.formProps}>…</form>
 *   <ActionBar record={record}><ButtonCancel /><ButtonSave /></ActionBar>
 */
export function useRecordForm<TValues extends FieldValues, TOutput = TValues>({
	form,
	onSave,
	id,
	deleteUrl,
	backTo,
	afterSave = "stay",
}: RecordFormOptions<TValues, TOutput>): RecordScope & { formProps: { id: string; onSubmit: (event: FormEvent) => void } } {
	const { isDirty, isSubmitting } = useFormState({ control: form.control });
	const routeId = useRouteId();
	const recordId = id !== undefined ? String(id) : routeId;
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const goBack = useGoBack(backTo);
	const formId = useId();

	const save = useCallback(
		async ({ leave = false }: { leave?: boolean } = {}) => {
			let saved = false;
			await form.handleSubmit(async (values) => {
				let result: SaveResult;
				try {
					result = await onSave(values);
				} catch (error) {
					if (!isHandledHttpError(error)) toast.error(t("actions.saveFailed"));
					return;
				}
				if (result === false) return;
				saved = true;
				const newId = result?.id !== undefined ? String(result.id) : undefined;
				emitAction(recordId === undefined ? "created" : "saved", { id: newId ?? recordId, message: result?.message });
				form.reset(form.getValues());
				if (leave || afterSave === "back") goBack();
				else if (recordId === undefined && newId !== undefined) {
					const base = pathname.replace(/\/+$/, "");
					navigate(base.endsWith("/new") ? `${parentPath(base)}/${newId}` : `${base}/${newId}`, { replace: true });
				}
			})();
			return saved;
		},
		[form, onSave, recordId, afterSave, goBack, navigate, pathname],
	);

	const onSubmit = useCallback(
		(event: FormEvent) => {
			event.preventDefault();
			void save();
		},
		[save],
	);

	return {
		dirty: isDirty,
		saving: isSubmitting,
		id: recordId,
		save,
		deleteUrl,
		backTo,
		formId,
		formProps: { id: formId, onSubmit },
	};
}
