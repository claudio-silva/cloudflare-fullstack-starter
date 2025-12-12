import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Alert, AlertDescription } from "../ui/alert";
import { Eye, EyeOff } from "lucide-react";

interface LoginFormProps {
	onSuccess?: () => void;
	showSignupLink?: boolean;
}

export function LoginForm({ onSuccess, showSignupLink = true }: LoginFormProps) {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const passwordRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (error && passwordRef.current) {
			passwordRef.current.focus();
			passwordRef.current.select();
		}
	}, [error]);

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
					autoFocus
				/>
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="password">Password</Label>
					<button
						type="button"
						onClick={() => navigate(`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`)}
						className="text-xs text-primary hover:underline bg-transparent border-none p-0 cursor-pointer"
					>
						Forgot password?
					</button>
				</div>
				<div className="relative">
					<Input
						ref={passwordRef}
						id="password"
						type={showPassword ? "text" : "password"}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						disabled={isLoading}
						required
						className="pr-10"
					/>
					<button
						type="button"
						onClick={() => {
							setShowPassword(!showPassword);
							passwordRef.current?.focus();
							// Set cursor to end of text
							setTimeout(() => {
								if (passwordRef.current) {
									const len = passwordRef.current.value.length;
									passwordRef.current.setSelectionRange(len, len);
								}
							}, 0);
						}}
						className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
						tabIndex={-1}
					>
						{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
					</button>
				</div>
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
