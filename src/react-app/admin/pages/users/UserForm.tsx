import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ClipboardList, History, LogOut, UserX, X } from "lucide-react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar, ButtonCancel, ButtonDelete, ButtonSave, useRecordForm, type SaveResult } from "@/components/actions";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth/client";
import { http, isHandledHttpError } from "@/lib/http";
import type { ApiErrorBody } from "../../../../shared/http-contract";
import { ROLES } from "../../../../shared/roles";
import { createUserSchema, type AdminUser, type AdminUserDetail } from "../../../../shared/admin-users";
import { AdminPage } from "../../components/AdminPage";
import { ACTION_BUTTON, TAB_LIST, TAB_TRIGGER } from "../../styles";
import { ROLE_LABELS, formatDateTime, formatDuration, formatIdle, methodLabel } from "./format";
import { UserActivity } from "./UserActivity";
import { countryName, noFocusOnClick } from "@/lib/admin-util";
import { RoleBadge, SignInMethods, StatusBadge, UserAvatar } from "./user-ui";
import { Panel } from "@/components/Panel";

/** The server's rules (src/shared/admin-users.ts), except that editing may leave the password empty. */
const formSchema = (isNew: boolean) =>
	createUserSchema
		.extend({
			password: z
				.string()
				.refine(
					(value) => (!isNew && value === "") || (value.length >= 8 && value.length <= 128),
					isNew ? "At least 8 characters." : "At least 8 characters, or leave it empty.",
				),
			confirmPassword: z.string(),
		})
		.refine((values) => values.password === values.confirmPassword, {
			message: "The passwords don't match.",
			path: ["confirmPassword"],
		});

type FormValues = z.input<ReturnType<typeof formSchema>>;

const EMPTY: FormValues = { name: "", email: "", role: "user", enabled: true, emailVerified: true, password: "", confirmPassword: "" };

const toValues = (user: AdminUser): FormValues => ({
	name: user.name ?? "",
	email: user.email,
	role: (ROLES as readonly string[]).includes(user.role) ? (user.role as FormValues["role"]) : "user",
	enabled: user.enabled,
	emailVerified: user.emailVerified,
	password: "",
	confirmPassword: "",
});

/**
 * The detail half of the CRUD example: `/admin/users/new` creates,
 * `/admin/users/:id` reads, updates and deletes.
 */
export function UserForm() {
	const { id } = useParams();
	const isNew = id === undefined;
	const myId = authClient.useSession().data?.user.id;
	const isMe = !isNew && id === myId;

	const [user, setUser] = useState<AdminUserDetail | null | "missing">(null);
	const [signingOut, setSigningOut] = useState(false);
	const schema = useMemo(() => formSchema(isNew), [isNew]);
	const form = useForm<FormValues, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema), defaultValues: EMPTY });

	useEffect(() => {
		if (id === undefined) return;
		let current = true;
		http(`/api/admin/users/${id}`, { handles: [404] })
			.then(async (res) => (res.status === 404 ? "missing" : ((await res.json()) as AdminUserDetail)))
			.then((detail) => {
				if (!current) return;
				setUser(detail);
				if (detail !== "missing") form.reset(toValues(detail));
			})
			.catch((error: unknown) => {
				if (!isHandledHttpError(error)) toast.error("The user could not be loaded.");
			});
		return () => {
			current = false;
		};
	}, [id, form]);

	// The action buttons save through it (and announce it: a toast by default); saving returns to the list.
	const record = useRecordForm({
		form,
		afterSave: "back",
		backTo: "/admin/users",
		deleteUrl: isNew ? undefined : `/api/admin/users/${id}`,
		onSave: async (values): Promise<SaveResult> => {
			const { name, email, role, enabled, emailVerified, password } = values;
			const body = { name, email, role, enabled, emailVerified, ...(password ? { password } : {}) };
			// 409 is ours: an email already in use belongs next to the field.
			const res = await http(isNew ? "/api/admin/users" : `/api/admin/users/${id}`, {
				method: isNew ? "POST" : "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				handles: [409],
			});
			if (res.status === 409) {
				const error = (await res.json()) as ApiErrorBody;
				if (error.code === "email_taken") form.setError("email", { message: error.error });
				else toast.error(error.error);
				return false;
			}
			return { message: isNew ? "User created." : password ? "User saved. They have been signed out everywhere." : "User saved." };
		},
	});

	const onSignOutEverywhere = async () => {
		if (!user || user === "missing") return;
		setSigningOut(true);
		try {
			await http(`/api/admin/users/${user.id}/sign-out`, { method: "POST" });
			toast.success("All sessions ended.");
			setUser({
				...user,
				status: user.status === "disabled" ? "disabled" : "offline",
				idleSeconds: null,
				activeSessions: 0,
				currentSession: null,
				activityCount: user.activityCount + user.activeSessions,
			});
		} catch (error) {
			if (!isHandledHttpError(error)) toast.error("The sessions could not be ended.");
		} finally {
			setSigningOut(false);
		}
	};

	if (user === "missing") {
		return (
			<AdminPage title="User not found" breadcrumbs={[{ title: "Not found" }]}>
				<Empty className="border py-16">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<UserX />
						</EmptyMedia>
						<EmptyTitle>This user no longer exists</EmptyTitle>
						<EmptyDescription>They may have been deleted by someone else.</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button asChild variant="outline" className={ACTION_BUTTON}>
							<Link to="/admin/users">Back to users</Link>
						</Button>
					</EmptyContent>
				</Empty>
			</AdminPage>
		);
	}

	if (!isNew && !user) return <FormSkeleton />;

	const title = isNew ? "New user" : user!.name || user!.email;
	const methods = isNew ? [] : user!.signInMethods;
	const hasPassword = methods.includes("credential");
	const usesGoogle = methods.includes("google");
	const otherMethods = methods.filter((m) => m !== "credential").map(methodLabel).join(" or ") || "another method";

	return (
		<AdminPage
			title={title}
			description={isNew ? "Create an account that signs in with an email and password." : user!.email}
			breadcrumbs={[{ title: isNew ? "New" : title }]}
		>
			<Tabs defaultValue="details" className="gap-6">
			{!isNew && (
				<TabsList variant="line" className={TAB_LIST}>
					<TabsTrigger value="details" className={TAB_TRIGGER} {...noFocusOnClick}>
						<ClipboardList />
						Profile
					</TabsTrigger>
					<TabsTrigger value="activity" className={TAB_TRIGGER} {...noFocusOnClick}>
						<History />
						Activity
						{user!.activityCount > 0 && (
							<Badge variant="secondary" className="ml-1 h-5 min-w-5 rounded-full bg-foreground/10 px-1.5 text-xs text-foreground">
								{user!.activityCount}
							</Badge>
						)}
					</TabsTrigger>
				</TabsList>
			)}
			<TabsContent value="details">
			<Form {...form}>
				<form {...record.formProps} className="grid items-start gap-6 lg:grid-cols-3">
					<div className="space-y-6 lg:col-span-2">
						<Panel title="Details" description="Who the user is and what they may do." bodyClassName="grid gap-5 sm:grid-cols-2">
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Name</FormLabel>
											<FormControl>
												<Input placeholder="Jane Doe" autoComplete="off" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="email"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Email</FormLabel>
											<FormControl>
												<Input type="email" placeholder="jane@example.com" autoComplete="off" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="role"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Role</FormLabel>
											<Select value={field.value} onValueChange={field.onChange} disabled={isMe}>
												<FormControl>
													<SelectTrigger className="w-full">
														<SelectValue />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{ROLES.map((role) => (
														<SelectItem key={role} value={role}>
															{ROLE_LABELS[role] ?? role}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormDescription>
												{isMe ? "You can't change your own role." : "Admins open this area; superadmins also manage users."}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="enabled"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Enabled</FormLabel>
											<div className="flex h-9 items-center gap-3">
												<FormControl>
													<Switch checked={field.value} onCheckedChange={field.onChange} disabled={isMe} />
												</FormControl>
												<span className="text-sm text-muted-foreground">{field.value ? "Can sign in" : "Cannot sign in"}</span>
											</div>
											<FormDescription>{isMe ? "You can't disable yourself." : "Disabling signs the user out everywhere."}</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="emailVerified"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Verified</FormLabel>
											<div className="flex h-9 items-center gap-3">
												<FormControl>
													<Switch checked={field.value} onCheckedChange={field.onChange} />
												</FormControl>
												<span className="text-sm text-muted-foreground">{field.value ? "Email address confirmed" : "Not confirmed"}</span>
											</div>
											<FormDescription>
												{usesGoogle
													? "Google confirms the address when they sign in with it."
													: "Unverified users can't sign in while email verification is required."}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
						</Panel>

						<Panel
							title="Password"
							description={
								isNew
									? "The user signs in with it and can change it from their profile."
									: hasPassword
										? "Leave empty to keep the current one. Setting a new one signs the user out everywhere."
										: `They sign in with ${otherMethods} and have no password. Setting one lets them also sign in with their email and password.`
							}
							bodyClassName="grid gap-5 sm:grid-cols-2"
						>
								<FormField
									control={form.control}
									name="password"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{isNew ? "Password" : "New password"}</FormLabel>
											<FormControl>
												<Input type="password" autoComplete="new-password" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="confirmPassword"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Confirm password</FormLabel>
											<FormControl>
												<Input type="password" autoComplete="new-password" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
						</Panel>
					</div>

					{!isNew && user && (
						<div className="space-y-6">
							<Panel
								tone="soft"
								title={
									<div className="space-y-3 py-2">
										<div className="flex items-center gap-3">
											<UserAvatar name={user.name} email={user.email} image={user.image} className="size-12" fallbackClassName="bg-primary text-sm text-primary-foreground" />
											<div className="min-w-0">
												<div className="truncate font-medium">{user.name || "—"}</div>
												<div className="truncate text-sm text-muted-foreground">{user.email}</div>
											</div>
										</div>
										<div className="flex flex-wrap gap-2">
											<RoleBadge role={user.role} />
											<StatusBadge status={user.status} />
										</div>
									</div>
								}
								bodyClassName="space-y-5"
							>
								<dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
									<dt className="text-muted-foreground">Created</dt>
									<dd className="text-right">{formatDateTime(user.createdAt)}</dd>
									<dt className="text-muted-foreground">Updated</dt>
									<dd className="text-right">{formatDateTime(user.updatedAt)}</dd>
									<dt className="text-muted-foreground">Sign-in with</dt>
									<dd className="text-right">
										<SignInMethods methods={user.signInMethods} />
									</dd>
									<dt className="text-muted-foreground">Last sign-in</dt>
									<dd className="text-right">{formatDateTime(user.lastSignInAt)}</dd>
									<dt className="text-muted-foreground">Last sign-out</dt>
									<dd className="text-right">{formatDateTime(user.lastSignOutAt)}</dd>
									<dt className="text-muted-foreground">Sign-ins</dt>
									<dd className="text-right tabular-nums">
										{user.signIns}
										{user.failedSignIns > 0 && <span className="text-muted-foreground"> ({user.failedSignIns} failed)</span>}
									</dd>
									<dt className="text-muted-foreground">Time in session</dt>
									<dd className="text-right">{formatDuration(user.usageSeconds)}</dd>
									<dt className="text-muted-foreground">In session</dt>
									<dd className="text-right">{user.idleSeconds === null ? "No" : `Yes, ${user.activeSessions} ${user.activeSessions === 1 ? "session" : "sessions"}`}</dd>
									{user.currentSession && (
										<>
											<dt className="text-muted-foreground">Idle time</dt>
											<dd className="text-right">{formatIdle(user.idleSeconds)}</dd>
											<dt className="text-muted-foreground">IP address</dt>
											<dd className="text-right">{user.currentSession.ip || "—"}</dd>
											<dt className="text-muted-foreground">Country</dt>
											<dd className="text-right" title={user.currentSession.country ?? undefined}>
												{countryName(user.currentSession.country)}
											</dd>
										</>
									)}
								</dl>
									<AlertDialog>
										<AlertDialogTrigger asChild>
											<Button type="button" variant="outline" disabled={signingOut || user.activeSessions === 0} className="w-full">
												{signingOut ? <Spinner /> : <LogOut />}
												Sign out everywhere
											</Button>
										</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Sign {isMe ? "yourself" : user.name || user.email} out everywhere?</AlertDialogTitle>
												<AlertDialogDescription>
													{isMe
														? "Every session of yours ends, this one included, and you will have to sign in again."
														: "Every session of this user ends. They can sign in again with their password."}
												</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel className={ACTION_BUTTON}>
													<X />
													Cancel
												</AlertDialogCancel>
												<AlertDialogAction onClick={onSignOutEverywhere} className={ACTION_BUTTON}>
													<LogOut />
													Sign out
												</AlertDialogAction>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
							</Panel>

						</div>
					)}
				</form>
			</Form>
			<ActionBar record={record} className="action-bar-fixed">
				<ButtonCancel />
				{!isNew && !isMe && (
					<ButtonDelete
						title={`Delete ${user!.name || user!.email}?`}
						message="The account, its sign-in methods and sessions are removed, and the user is signed out. Its history stays in the sign-in log. This cannot be undone."
					/>
				)}
				<ButtonSave label={isNew ? "Create user" : undefined} />
			</ActionBar>
			</TabsContent>
			{!isNew && (
				<TabsContent value="activity">
					<UserActivity userId={user!.id} />
				</TabsContent>
			)}
			</Tabs>
		</AdminPage>
	);
}

function FormSkeleton() {
	return (
		<AdminPage title="" breadcrumbs={[{ title: "…" }]}>
			<div className="grid gap-6 lg:grid-cols-3">
				<Skeleton className="h-80 lg:col-span-2" />
				<Skeleton className="h-64" />
			</div>
		</AdminPage>
	);
}
