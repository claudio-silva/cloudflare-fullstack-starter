import { useEffect, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronLeft, Plus, Printer, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { http, isHandledHttpError } from "@/lib/http";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { emitAction } from "./events";
import { RecordContext, useGoBack, useRecordScope, useRouteId, type RecordScope } from "./record";

/**
 * A row of action buttons, right-aligned, under a rule (the class
 * `action-bar`, index.css). `action-bar-unstyled` takes the rule and spacing
 * away, for a bar inside something else (a page header); `action-bar-fixed` makes it a bar that stays at the bottom of the
 * viewport, above the footer; while it floats over the page it carries
 * `data-stuck`. `record` tells the buttons inside about the form: see
 * `useRecordForm()`.
 */
export function ActionBar({ record, className, children, ...props }: ComponentProps<"div"> & { record?: RecordScope }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el || getComputedStyle(el).position !== "sticky") return;
		// Sticky at `bottom: -1px`: floating, one pixel of it is cut off; at rest, it is all in view.
		const observer = new IntersectionObserver(
			([entry]) => el.toggleAttribute("data-stuck", entry.intersectionRatio > 0 && entry.intersectionRatio < 1),
			{ threshold: [0, 1] },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [className]);

	const bar = (
		<div ref={ref} data-slot="action-bar" role="toolbar" className={cn("action-bar flex flex-wrap items-center justify-end gap-2", className)} {...props}>
			{children}
		</div>
	);
	return record ? <RecordContext value={record}>{bar}</RecordContext> : bar;
}

/**
 * Runs before a button's own action. `true` lets the action go ahead; `false`
 * cancels it; nothing (`undefined`) means the handler did the job instead.
 */
export type ActionClick = (event: MouseEvent<HTMLElement>) => boolean | void | Promise<boolean | void>;

type ActionButtonProps = Omit<ComponentProps<typeof Button>, "onClick" | "children" | "asChild"> & {
	label?: ReactNode;
	/** An element (`<Gift />`), or `null` for none. */
	icon?: ReactNode;
	onClick?: ActionClick;
};

async function proceed(onClick: ActionClick | undefined, event: MouseEvent<HTMLElement>): Promise<boolean> {
	if (!onClick) return true;
	return (await onClick(event)) === true;
}

/** One width for every action button: `--action-button-w` (the admin area sets it), else as wide as its label. */
const WIDTH = "min-w-[var(--action-button-w,auto)]";

function ActionButton({ label, icon, busy, className, variant = "outline", ...props }: Omit<ActionButtonProps, "onClick"> & { busy?: boolean; onClick?: (event: MouseEvent<HTMLButtonElement>) => void }) {
	return (
		<Button type="button" variant={variant} className={cn(WIDTH, className)} {...props}>
			{/* The spinner takes the icon's place while working. */}
			{busy ? <Spinner /> : icon}
			{label}
		</Button>
	);
}

/** Enabled while the form has unsaved changes; validates and saves it. */
export function ButtonSave({ label = t("actions.save"), icon = <Save />, onClick, disabled, ...props }: ActionButtonProps) {
	const record = useRecordScope();
	const saving = record?.saving ?? false;
	return (
		<ActionButton
			// A submit button of the form, wherever it is, so that Enter in a field presses it.
			type="submit"
			form={record?.formId}
			variant="default"
			label={label}
			icon={icon}
			busy={saving}
			disabled={disabled ?? (saving || (record ? !record.dirty : false))}
			onClick={async (event) => {
				const form = event.currentTarget.form;
				event.preventDefault();
				if (!(await proceed(onClick, event))) return;
				if (record?.save) await record.save();
				else form?.requestSubmit();
			}}
			{...props}
		/>
	);
}

/**
 * Goes back. With unsaved changes it says Cancel and first asks whether to
 * save them; without, it says Back. `label`/`icon` are the Cancel ones,
 * `backLabel`/`backIcon` the Back ones.
 */
export function ButtonCancel({
	label = t("actions.cancel"),
	icon = <X />,
	backLabel = t("actions.back"),
	backIcon = <ChevronLeft />,
	onClick,
	...props
}: ActionButtonProps & { backLabel?: ReactNode; backIcon?: ReactNode }) {
	const record = useRecordScope();
	const goBack = useGoBack(record?.backTo);
	const [asking, setAsking] = useState(false);
	const dirty = record?.dirty ?? false;

	const discard = () => {
		setAsking(false);
		emitAction("discarded", { id: record?.id });
		goBack();
	};

	return (
		<>
			<ActionButton
				label={dirty ? label : backLabel}
				icon={dirty ? icon : backIcon}
				onClick={async (event) => {
					if (!(await proceed(onClick, event))) return;
					if (dirty) setAsking(true);
					else {
						emitAction("back", { id: record?.id });
						goBack();
					}
				}}
				{...props}
			/>
			<AlertDialog open={asking} onOpenChange={setAsking}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("actions.unsavedTitle")}</AlertDialogTitle>
						<AlertDialogDescription>{t("actions.unsavedBody")}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("actions.keepEditing")}</AlertDialogCancel>
						<Button variant="outline" onClick={discard}>
							{t("actions.discard")}
						</Button>
						{record?.save && (
							<AlertDialogAction
								onClick={() => {
									setAsking(false);
									void record.save?.({ leave: true });
								}}
							>
								<Save />
								{t("actions.save")}
							</AlertDialogAction>
						)}
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

/** Goes back, for pages without a form: unsaved changes are not checked. `to` goes there instead. */
export function ButtonBack({ label = t("actions.back"), icon = <ArrowLeft />, onClick, to, ...props }: ActionButtonProps & { to?: string }) {
	const record = useRecordScope();
	const goBack = useGoBack(record?.backTo);
	const navigate = useNavigate();
	return (
		<ActionButton
			label={label}
			icon={icon}
			onClick={async (event) => {
				if (!(await proceed(onClick, event))) return;
				emitAction("back", { id: record?.id });
				if (to) navigate(to);
				else goBack();
			}}
			{...props}
		/>
	);
}

/** For lists: opens the detail page with no record, `to` (default: this path + `/new`). */
export function ButtonNew({ label = t("actions.new"), icon = <Plus />, onClick, to, className, ...props }: ActionButtonProps & { to?: string }) {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const target = to ?? `${pathname.replace(/\/+$/, "")}/new`;
	return (
		<Button asChild variant="success" className={cn(WIDTH, className)} {...props}>
			{/* A link, so it opens in a new tab too. */}
			<Link
				to={target}
				onClick={async (event) => {
					if (!onClick) return emitAction("new");
					event.preventDefault();
					if (!(await proceed(onClick, event))) return;
					emitAction("new");
					navigate(target);
				}}
			>
				{icon}
				{label}
			</Link>
		</Button>
	);
}

/**
 * Sends `DELETE` to `url` (default: the record's `deleteUrl`), after asking
 * unless `confirm={false}`, then goes back. `title` and `message` are the
 * question's.
 */
export function ButtonDelete({
	label = t("actions.delete"),
	icon = <Trash2 />,
	onClick,
	url,
	confirm = true,
	title = t("actions.deleteTitle"),
	message = t("actions.deleteBody"),
	disabled,
	...props
}: ActionButtonProps & { url?: string; confirm?: boolean; title?: ReactNode; message?: ReactNode }) {
	const record = useRecordScope();
	const goBack = useGoBack(record?.backTo);
	const target = url ?? record?.deleteUrl;
	const [asking, setAsking] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const run = async () => {
		if (!target) return;
		setAsking(false);
		setDeleting(true);
		try {
			await http(target, { method: "DELETE" });
			emitAction("deleted", { id: record?.id });
			goBack();
		} catch (error) {
			if (!isHandledHttpError(error)) toast.error(t("actions.deleteFailed"));
			setDeleting(false);
		}
	};

	return (
		<>
			<ActionButton
				variant="destructive"
				label={label}
				icon={icon}
				busy={deleting}
				disabled={disabled ?? (!target || deleting || record?.saving)}
				onClick={async (event) => {
					if (!(await proceed(onClick, event))) return;
					if (confirm) setAsking(true);
					else await run();
				}}
				{...props}
			/>
			<AlertDialog open={asking} onOpenChange={setAsking}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{title}</AlertDialogTitle>
						<AlertDialogDescription>{message}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
						<AlertDialogAction variant="destructive" onClick={run}>
							<Trash2 />
							{t("actions.delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

/** Calls `onClick`, and nothing else; enabled once the record is saved (it has an id). */
export function ButtonPrint({ label = t("actions.print"), icon = <Printer />, onClick, disabled, ...props }: ActionButtonProps) {
	const record = useRecordScope();
	const routeId = useRouteId();
	const id = record ? record.id : routeId;
	return (
		<ActionButton
			label={label}
			icon={icon}
			disabled={disabled ?? id === undefined}
			onClick={(event) => {
				void onClick?.(event);
			}}
			{...props}
		/>
	);
}
