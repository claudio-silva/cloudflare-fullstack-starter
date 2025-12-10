import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Alert, AlertDescription } from "../ui/alert";

interface LoginFormProps {
	onSuccess?: () => void;
	showSignupLink?: boolean;
}

export function LoginForm({ onSuccess, showSignupLink = true }: LoginFormProps) {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setIsLoading(true);

		try {
			const result = await authClient.signIn.email({
				email,
				password,
				fetchOptions: {
					onSuccess: () => {
						// Session is automatically refreshed by Better Auth client
						// Call onSuccess callback to trigger re-render in parent
						onSuccess?.();
					},
				},
			});
			if (result.error) {
				if (result.error.message?.includes("not verified")) {
					setError("Please verify your email before signing in.");
				} else if (result.error.message?.includes("Invalid")) {
					setError("Invalid email or password.");
				} else {
					setError(result.error.message || "Failed to sign in.");
				}
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "An unexpected error occurred.";
			setError(message);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			{error && (
				<Alert variant="destructive" className="bg-red-50 dark:bg-red-950 border-red-500">
					<AlertDescription className="text-red-800 dark:text-red-200">{error}</AlertDescription>
				</Alert>
			)}

			<div className="space-y-2">
				<Label htmlFor="email">Email</Label>
				<Input
					id="email"
					type="email"
					placeholder="you@example.com"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					disabled={isLoading}
					required
				/>
			</div>

			<div className="space-y-2">
				<Label htmlFor="password">Password</Label>
				<Input
					id="password"
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					disabled={isLoading}
					required
				/>
			</div>

			<Button type="submit" className="w-full" disabled={isLoading}>
				{isLoading ? "Signing in..." : "Sign In"}
			</Button>

			{showSignupLink && (
				<div className="mt-4 text-center text-sm text-muted-foreground">
					<p>
						Don't have an account?{" "}
						<button
							type="button"
							onClick={() => navigate("/signup")}
							className="text-primary hover:underline bg-transparent border-none p-0 cursor-pointer"
						>
							Sign up
						</button>
					</p>
				</div>
			)}
		</form>
	);
}
