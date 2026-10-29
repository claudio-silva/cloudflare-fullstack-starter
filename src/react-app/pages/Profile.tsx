import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth/client";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { http, isHandledHttpError } from "@/lib/http";

export function Profile() {
	const { data: session } = authClient.useSession();
	const navigate = useNavigate();
	const [isSavingName, setIsSavingName] = useState(false);
	const [isChangingPassword, setIsChangingPassword] = useState(false);
	const [isDeletingAccount, setIsDeletingAccount] = useState(false);

	const [name, setName] = useState(session?.user.name || "");
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const dateOf = (value: Date | string) => new Date(value).toLocaleDateString();

	const nameChanged = name !== (session?.user.name ?? "");
	const wantsPassword = Boolean(currentPassword || newPassword || confirmPassword);
	const saving = isSavingName || isChangingPassword;

	/** What is wrong with the form, before anything is sent: a half-saved profile would be worse. */
	const problem = (): string | null => {
		if (nameChanged && !name.trim()) return "Name cannot be empty";
		if (!wantsPassword) return null;
		if (!currentPassword.trim()) return "Current password is required";
		if (!newPassword.trim()) return "New password cannot be empty";
		if (newPassword.length < 8) return "Password must be at least 8 characters";
		if (newPassword !== confirmPassword) return "Passwords do not match";
		if (currentPassword === newPassword) return "New password must be different from current password";
		return null;
	};

	/** One button saves whatever changed; each part reports its own failure. */
	const handleSave = async () => {
		const invalid = problem();
		if (invalid) {
			toast.error(invalid);
			return;
		}
		if (nameChanged && !(await handleUpdateName())) return;
		if (wantsPassword) await handleChangePassword();
	};

	/** Leaves the page without saving: back where the user came from, or home. */
	const handleCancel = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/"));

	const handleUpdateName = async (): Promise<boolean> => {
		setIsSavingName(true);
		try {
			// Better Auth's client reports failures in `error` rather than throwing.
			const result = await authClient.updateUser({
				name: name.trim(),
			});

			if (result.error) {
				toast.error(result.error.message || "Failed to update name");
				return false;
			}

			toast.success("Name updated successfully");
			return true;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to update name";
			toast.error(message);
			return false;
		} finally {
			setIsSavingName(false);
		}
	};

	const handleChangePassword = async () => {
		setIsChangingPassword(true);
		try {
			const result = await authClient.changePassword({
				currentPassword,
				newPassword,
				revokeOtherSessions: true,
			});

			if (result.error) {
				toast.error(result.error.message || "Failed to change password");
				return;
			}

			toast.success("Password changed successfully. All other sessions have been logged out.");
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to change password";
			if (message.toLowerCase().includes("incorrect") || message.toLowerCase().includes("invalid") || message.toLowerCase().includes("wrong")) {
				toast.error("Current password is incorrect");
			} else {
				toast.error(message);
			}
		} finally {
			setIsChangingPassword(false);
		}
	};

	const handleDeleteAccount = async () => {
		setIsDeletingAccount(true);
		try {
			// No `if (!response.ok)`: a failure is shown by the HTTP layer and
			// rejects, so the lines below only run when it worked.
			await http("/api/profile", {
				method: "DELETE",
				credentials: "include",
			});

			toast.success("Account deleted successfully");

			// Sign out and redirect to home
			await authClient.signOut({
				fetchOptions: {
					onSuccess: () => {
						navigate("/");
					},
				},
			});
		} catch (error: unknown) {
			// Already shown to the user; anything else is ours to report.
			if (!isHandledHttpError(error)) toast.error(error instanceof Error ? error.message : "Failed to delete account");
		} finally {
			setIsDeletingAccount(false);
			setShowDeleteConfirm(false);
		}
	};

	if (!session) {
		return null;
	}

	const { user } = session;
	const initials = (user.name || user.email)
		.split(/\s+/)
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();

	return (
		<div className="h-full overflow-auto bg-slate-50 dark:bg-slate-950">
			<div className="mx-auto max-w-7xl space-y-6 px-4 py-8 md:px-8">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Profile</h1>
					<p className="text-muted-foreground">Your account details and password.</p>
				</div>

				<div className="grid items-start gap-6 lg:grid-cols-3">
					<div className="space-y-6 lg:col-span-2">
						<Card>
							<CardHeader>
								<CardTitle>Details</CardTitle>
								<CardDescription>How you appear in the app.</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="grid items-start gap-5 sm:grid-cols-2">
									<div className="grid content-start gap-2">
										<Label htmlFor="name">Name</Label>
										<Input id="name" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
									</div>
									<div className="grid content-start gap-2">
										<Label htmlFor="email">Email</Label>
										<Input id="email" value={user.email} disabled readOnly />
									</div>
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle>Password</CardTitle>
								<CardDescription>Leave empty to keep the current one. Changing it signs you out of every other device.</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="grid items-start gap-5 sm:grid-cols-2">
									<div className="grid content-start gap-2 sm:col-span-2 sm:max-w-[calc(50%-0.625rem)]">
										<Label htmlFor="currentPassword">Current password</Label>
										<Input
											id="currentPassword"
											type="password"
											autoComplete="current-password"
											value={currentPassword}
											onChange={(e) => setCurrentPassword(e.target.value)}
											disabled={saving}
										/>
									</div>
									<div className="grid content-start gap-2">
										<Label htmlFor="newPassword">New password</Label>
										<Input
											id="newPassword"
											type="password"
											autoComplete="new-password"
											value={newPassword}
											onChange={(e) => setNewPassword(e.target.value)}
											disabled={saving}
											placeholder="At least 8 characters"
										/>
									</div>
									<div className="grid content-start gap-2">
										<Label htmlFor="confirmPassword">Confirm new password</Label>
										<Input
											id="confirmPassword"
											type="password"
											autoComplete="new-password"
											value={confirmPassword}
											onChange={(e) => setConfirmPassword(e.target.value)}
											disabled={saving}
										/>
									</div>
								</div>
							</CardContent>
						</Card>

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleCancel} disabled={saving} className="w-40">
								<X />
								Cancel
							</Button>
							<Button onClick={handleSave} disabled={saving || (!nameChanged && !wantsPassword)} className="w-40">
								{saving ? <Spinner /> : <Save />}
								Save changes
							</Button>
						</div>
					</div>

					<div className="space-y-6">
						<Card>
							<CardContent className="space-y-5">
								<div className="flex items-center gap-3">
									<Avatar className="size-12">
										<AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">{initials}</AvatarFallback>
									</Avatar>
									<div className="min-w-0">
										<div className="truncate font-medium">{user.name || "—"}</div>
										<div className="truncate text-sm text-muted-foreground">{user.email}</div>
									</div>
								</div>
								{user.role && (
									<div className="flex flex-wrap gap-2">
										<Badge variant="outline" className="capitalize">
											{user.role}
										</Badge>
									</div>
								)}
								<Separator />
								<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
									<dt className="text-muted-foreground">Member since</dt>
									<dd className="text-right">{dateOf(user.createdAt)}</dd>
									<dt className="text-muted-foreground">Updated</dt>
									<dd className="text-right">{dateOf(user.updatedAt)}</dd>
								</dl>
							</CardContent>
						</Card>

						<Card className="border-destructive/30">
							<CardHeader>
								<CardTitle>Delete account</CardTitle>
								<CardDescription>Removes your account and everything attached to it. This cannot be undone.</CardDescription>
							</CardHeader>
							<CardContent>
								<Button variant="destructive" onClick={() => setShowDeleteConfirm(true)} disabled={isDeletingAccount} className="w-40">
									{isDeletingAccount ? <Spinner /> : <Trash2 />}
									Delete account
								</Button>
							</CardContent>
						</Card>
					</div>
				</div>
			</div>

			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete your account?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes your account and all associated data. This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="w-40">
							<X />
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction variant="destructive" onClick={handleDeleteAccount} className="w-40">
							<Trash2 />
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
