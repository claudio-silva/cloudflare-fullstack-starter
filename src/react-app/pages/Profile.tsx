import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function Profile() {
	const { data: session } = authClient.useSession();
	const user = session?.user;

	const [name, setName] = useState(user?.name ?? "");
	const [email, setEmail] = useState(user?.email ?? "");
	const [password, setPassword] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loadingProfile, setLoadingProfile] = useState(false);
	const [loadingPassword, setLoadingPassword] = useState(false);

	const handleProfileSave = async () => {
		setError(null);
		setMessage(null);
		setLoadingProfile(true);
		try {
			await authClient.updateUser.mutate({ name, email });
			setMessage("Profile updated");
		} catch (err: any) {
			setError(err.message || "Failed to update profile");
		} finally {
			setLoadingProfile(false);
		}
	};

	const handlePasswordSave = async () => {
		setError(null);
		setMessage(null);
		setLoadingPassword(true);
		try {
			await authClient.changePassword.mutate({ password });
			setMessage("Password updated");
			setPassword("");
		} catch (err: any) {
			setError(err.message || "Failed to update password");
		} finally {
			setLoadingPassword(false);
		}
	};

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Profile</CardTitle>
					<CardDescription>Update your name and email address.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="name">Name</Label>
						<Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="space-y-2">
						<Label htmlFor="email">Email</Label>
						<Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
					</div>
					<Button onClick={handleProfileSave} disabled={loadingProfile}>
						{loadingProfile ? "Saving..." : "Save changes"}
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Change Password</CardTitle>
					<CardDescription>Set a new password for your account.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="password">New password</Label>
						<Input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="At least 8 characters"
						/>
					</div>
					<Button onClick={handlePasswordSave} disabled={loadingPassword || password.length < 8}>
						{loadingPassword ? "Updating..." : "Update password"}
					</Button>
				</CardContent>
			</Card>

			{(message || error) && (
				<div className="lg:col-span-2">
					<Alert variant={error ? "destructive" : "default"}>
						<AlertDescription>{error || message}</AlertDescription>
					</Alert>
				</div>
			)}
		</div>
	);
}
