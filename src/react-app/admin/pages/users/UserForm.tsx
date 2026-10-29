import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ClipboardList, History, Save, Trash2, UserX, X } from "lucide-react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth/client";
import { http, isHandledHttpError } from "@/lib/http";
import type { ApiErrorBody } from "../../../../shared/http-contract";
import { ROLES } from "../../../../shared/roles";
import { createUserSchema, type AdminUser, type AdminUserDetail } from "../../../../shared/admin-users";
import { AdminPage } from "../../components/AdminPage";
import { ACTION_BUTTON, TAB_LIST, TAB_TRIGGER } from "../../styles";
import { ROLE_LABELS, formatDateTime, formatIdle } from "./format";
import { UserActivity } from "./UserActivity";
import { RoleBadge, StatusBadge, UserAvatar } from "./user-ui";

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

const EMPTY: FormValues = { name: "", email: "", role: "user", emailVerified: true, password: "", confirmPassword: "" };

const toValues = (user: AdminUser): FormValues => ({
	name: user.name ?? "",
	email: user.email,
	role: (ROLES as readonly string[]).includes(user.role) ? (user.role as FormValues["role"]) : "user",
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
	const navigate = useNavigate();
	const myId = authClient.useSession().data?.user.id;
	const isMe = !isNew && id === myId;

	const [user, setUser] = useState<AdminUserDetail | null | "missing">(null);
	const [deleting, setDeleting] = useState(false);
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

	const onSubmit = async (values: z.output<typeof schema>) => {
		const { name, email, role, emailVerified, password } = values;
		const body = { name, email, role, emailVerified, ...(password ? { password } : {}) };
		try {
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
				return;
			}
			toast.success(isNew ? "User created." : password ? "User saved. They have been signed out everywhere." : "User saved.");
			navigate("/admin/users");
		} catch (error) {
			if (!isHandledHttpError(error)) toast.error("The user could not be saved.");
		}
	};

	const onDelete = async () => {
		setDeleting(true);
		try {
			await http(`/api/admin/users/${id}`, { method: "DELETE" });
			toast.success("User deleted.");
			navigate("/admin/users");
		} catch (error) {
			if (!isHandledHttpError(error)) toast.error("The user could not be deleted.");
			setDeleting(false);
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
	const { isSubmitting, isDirty } = form.formState;

	return (
		<AdminPage
			title={title}
			description={isNew ? "Create an account that signs in with an email and password." : user!.email}
			breadcrumbs={[{ title: isNew ? "New" : title }]}
		>
			<Tabs defaultValue="details" className="gap-6">
			{!isNew && (
				<TabsList variant="line" className={TAB_LIST}>
					<TabsTrigger value="details" className={TAB_TRIGGER}>
						<ClipboardList />
						Profile
					</TabsTrigger>
					<TabsTrigger value="activity" className={TAB_TRIGGER}>
						<History />
						Activity
					</TabsTrigger>
				</TabsList>
			)}
			<TabsContent value="details">
			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="grid items-start gap-6 lg:grid-cols-3">
					<div className="space-y-6 lg:col-span-2">
						<Card>
							<CardHeader>
								<CardTitle>Details</CardTitle>
								<CardDescription>Who the user is and what they may do.</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-5 sm:grid-cols-2">
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
									name="emailVerified"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Active</FormLabel>
											<div className="flex h-9 items-center gap-3">
												<FormControl>
													<Switch checked={field.value} onCheckedChange={field.onChange} disabled={isMe} />
												</FormControl>
												<span className="text-sm text-muted-foreground">{field.value ? "Can sign in" : "Cannot sign in"}</span>
											</div>
											<FormDescription>The email is treated as verified.</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle>Password</CardTitle>
								<CardDescription>
									{isNew
										? "The user signs in with it and can change it from their profile."
										: "Leave empty to keep the current one. Setting a new one signs the user out everywhere."}
								</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-5 sm:grid-cols-2">
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
							</CardContent>
						</Card>

						<div className="flex justify-end gap-2">
							<Button type="button" variant="outline" asChild className={ACTION_BUTTON}>
								<Link to="/admin/users">
									<X />
									Cancel
								</Link>
							</Button>
							<Button type="submit" disabled={isSubmitting || (!isNew && !isDirty)} className={ACTION_BUTTON}>
								{/* The spinner takes the icon's place while saving. */}
								{isSubmitting ? <Spinner /> : <Save />}
								{isNew ? "Create user" : "Save changes"}
							</Button>
						</div>
					</div>

					{!isNew && user && (
						<div className="space-y-6">
							<Card>
								<CardContent className="space-y-5">
									<div className="flex items-center gap-3">
										<UserAvatar name={user.name} email={user.email} className="size-12" />
										<div className="min-w-0">
											<div className="truncate font-medium">{user.name || "—"}</div>
											<div className="truncate text-sm text-muted-foreground">{user.email}</div>
										</div>
									</div>
									<div className="flex flex-wrap gap-2">
										<RoleBadge role={user.role} />
										<StatusBadge status={user.status} />
									</div>
									<Separator />
									<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
										<dt className="text-muted-foreground">Created</dt>
										<dd className="text-right">{formatDateTime(user.createdAt)}</dd>
										<dt className="text-muted-foreground">Updated</dt>
										<dd className="text-right">{formatDateTime(user.updatedAt)}</dd>
										<dt className="text-muted-foreground">Last sign-in</dt>
										<dd className="text-right">{formatDateTime(user.lastSignInAt)}</dd>
										<dt className="text-muted-foreground">Last sign-out</dt>
										<dd className="text-right">{formatDateTime(user.lastSignOutAt)}</dd>
										<dt className="text-muted-foreground">In session</dt>
										<dd className="text-right">{user.idleSeconds === null ? "No" : "Yes"}</dd>
										<dt className="text-muted-foreground">Idle time</dt>
										<dd className="text-right">{formatIdle(user.idleSeconds)}</dd>
										<dt className="text-muted-foreground">Sign-in with</dt>
										<dd className="text-right">{user.signInMethods.map((m) => (m === "credential" ? "password" : m)).join(", ") || "—"}</dd>
										<dt className="text-muted-foreground">Sessions</dt>
										<dd className="text-right">{user.activeSessions}</dd>
									</dl>
								</CardContent>
							</Card>

							{!isMe && (
								<Card className="border-destructive/30">
									<CardHeader>
										<CardTitle>Delete user</CardTitle>
										<CardDescription>Removes the account, its sign-in methods and sessions. This cannot be undone.</CardDescription>
									</CardHeader>
									<CardContent>
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button type="button" variant="destructive" disabled={deleting} className={ACTION_BUTTON}>
													{deleting ? <Spinner /> : <Trash2 />}
													Delete user
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Delete {user.name || user.email}?</AlertDialogTitle>
													<AlertDialogDescription>
														The account and everything attached to it is removed, and the user is signed out. This cannot be undone.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel className={ACTION_BUTTON}>
														<X />
														Cancel
													</AlertDialogCancel>
													<AlertDialogAction variant="destructive" onClick={onDelete} className={ACTION_BUTTON}>
														<Trash2 />
														Delete
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									</CardContent>
								</Card>
							)}
						</div>
					)}
				</form>
			</Form>
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
