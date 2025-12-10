import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { User, Key, Trash2 } from "lucide-react";
import { toast } from "sonner";

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

	const handleUpdateName = async () => {
		if (!name.trim()) {
			toast.error("Name cannot be empty");
			return;
		}

		setIsSavingName(true);
		try {
			await authClient.updateUser({
				name: name.trim(),
			});

			toast.success("Name updated successfully");
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to update name";
			toast.error(message);
		} finally {
			setIsSavingName(false);
		}
	};

	const handleChangePassword = async () => {
		if (!currentPassword || !currentPassword.trim()) {
			toast.error("Current password is required");
			return;
		}

		if (!newPassword || !newPassword.trim()) {
			toast.error("New password cannot be empty");
			return;
		}

		if (newPassword.length < 8) {
			toast.error("Password must be at least 8 characters");
			return;
		}

		if (newPassword !== confirmPassword) {
			toast.error("Passwords do not match");
			return;
		}

		if (currentPassword === newPassword) {
			toast.error("New password must be different from current password");
			return;
		}

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
		if (!showDeleteConfirm) {
			setShowDeleteConfirm(true);
			return;
		}

		setIsDeletingAccount(true);
		try {
			const response = await fetch("/api/profile", {
				method: "DELETE",
				credentials: "include",
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || "Failed to delete account");
			}

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
			const message = error instanceof Error ? error.message : "Failed to delete account";
			toast.error(message);
		} finally {
			setIsDeletingAccount(false);
			setShowDeleteConfirm(false);
		}
	};

	if (!session) {
		return null;
	}

	return (
		<div className="h-full bg-slate-50 dark:bg-slate-950 overflow-auto">
			<div className="px-4 py-8 max-w-7xl mx-auto">
				<div className="space-y-6">
					{/* Header */}
					<div>
						<h1 className="text-3xl font-bold">Profile Settings</h1>
						<p className="text-muted-foreground">Manage your account information and preferences</p>
					</div>

					{/* Two Column Layout */}
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
						{/* Left Column */}
						<div className="space-y-6">
							{/* Account Information */}
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<User className="h-5 w-5" />
										Account Information
									</CardTitle>
									<CardDescription>Your basic account details</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="text-muted-foreground">Email</Label>
											<p className="text-sm font-medium mt-1">{session.user.email}</p>
										</div>
										<div>
											<Label className="text-muted-foreground">Status</Label>
											<div className="mt-1">
												<Badge variant="secondary" className="text-xs">
													Active
												</Badge>
											</div>
										</div>
									</div>

									<Separator />

									<div className="space-y-2">
										<Label htmlFor="name">Display Name</Label>
										<div className="flex gap-2">
											<Input
												id="name"
												type="text"
												value={name}
												onChange={(e) => setName(e.target.value)}
												disabled={isSavingName}
												className="flex-1"
											/>
											<Button
												onClick={handleUpdateName}
												disabled={isSavingName || name === session.user.name}
												size="sm"
											>
												Save
											</Button>
										</div>
									</div>
								</CardContent>
							</Card>
						</div>

						{/* Right Column */}
						<div className="space-y-6">
							{/* Security */}
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<Key className="h-5 w-5" />
										Security
									</CardTitle>
									<CardDescription>Change your password</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="space-y-2">
										<Label htmlFor="currentPassword">Current Password</Label>
										<Input
											id="currentPassword"
											type="password"
											value={currentPassword}
											onChange={(e) => setCurrentPassword(e.target.value)}
											disabled={isChangingPassword}
											placeholder="Enter your current password"
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="newPassword">New Password</Label>
										<Input
											id="newPassword"
											type="password"
											value={newPassword}
											onChange={(e) => setNewPassword(e.target.value)}
											disabled={isChangingPassword}
											placeholder="Min. 8 characters"
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="confirmPassword">Confirm New Password</Label>
										<Input
											id="confirmPassword"
											type="password"
											value={confirmPassword}
											onChange={(e) => setConfirmPassword(e.target.value)}
											disabled={isChangingPassword}
											placeholder="Re-enter new password"
										/>
									</div>

									<Button
										onClick={handleChangePassword}
										disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
										className="w-full"
									>
										Change Password
									</Button>
								</CardContent>
							</Card>

							{/* Danger Zone */}
							<Card className="border-destructive">
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-destructive">
										<Trash2 className="h-5 w-5" />
										Danger Zone
									</CardTitle>
									<CardDescription>Permanently delete your account</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<p className="text-sm text-muted-foreground">
										Once you delete your account, there is no going back. This action is permanent.
									</p>
									{showDeleteConfirm && (
										<div className="bg-destructive/10 p-4 rounded-lg space-y-3">
											<p className="text-sm font-medium text-destructive">
												Are you absolutely sure?
											</p>
											<p className="text-sm text-muted-foreground">
												This will permanently delete your account and all associated data.
											</p>
											<div className="flex gap-2">
												<Button
													variant="destructive"
													onClick={handleDeleteAccount}
													disabled={isDeletingAccount}
													size="sm"
													className="flex-1"
												>
													Yes, Delete
												</Button>
												<Button
													variant="outline"
													onClick={() => setShowDeleteConfirm(false)}
													disabled={isDeletingAccount}
													size="sm"
													className="flex-1"
												>
													Cancel
												</Button>
											</div>
										</div>
									)}
									{!showDeleteConfirm && (
										<Button variant="destructive" onClick={handleDeleteAccount} className="w-full">
											Delete Account
										</Button>
									)}
								</CardContent>
							</Card>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
