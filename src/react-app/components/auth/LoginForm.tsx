import { useState, useRef, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth/client";
import { signInErrorMessage } from "../../../shared/sign-in-error-message";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Alert, AlertDescription } from "../ui/alert";
import { Eye, EyeOff } from "lucide-react";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { useDemoAccounts } from "@/lib/demo";
import { useAuthFeatures } from "@/lib/auth-features";
import { confirmAndDiscardForNavigation } from "./leave-session";

/** "Admin" for an account with the admin role; its address when it has none. */
const roleLabel = (account: { email: string; role: string | null }) =>
	account.role ? account.role.charAt(0).toUpperCase() + account.role.slice(1) : account.email;

interface LoginFormProps {
	onSuccess?: () => void;
	showSignupLink?: boolean;
	/**
	 * Set when a session ended under an open page: the account is shown as text and
	 * only the password is asked. Hides what would change the account (sign-up, demo
	 * accounts, Google).
	 */
	lockedEmail?: string;
	/** Shown beside the forgot-password link in locked mode ("Use another account"). */
	lockedFooter?: ReactNode;
}

export function LoginForm({ onSuccess, showSignupLink = true, lockedEmail, lockedFooter }: LoginFormProps) {
	const locked = lockedEmail !== undefined;
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const passwordRef = useRef<HTMLInputElement>(null);
	// The public demo: offer its accounts, and hide what it would refuse anyway.
	const demoAccounts = useDemoAccounts();
	const demo = demoAccounts;
	// Which methods this deployment really offers; see src/react-app/lib/auth-features.ts.
	const features = useAuthFeatures();
	const isDemo = !!demo;

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
				email: lockedEmail ?? email,
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
				setError(signInErrorMessage(result.error, window.location.origin));
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

			{demo && !locked && (
				<Alert>
					<AlertDescription className="flex flex-col gap-2">
						<span>
							This is a read-only demo.{" "}
							{demo.length === 1 ? (
								<>
									Sign in as <strong>{demo[0].email}</strong> with password <strong>{demo[0].password}</strong>.
								</>
							) : (
								<>
									Every account&apos;s password is <strong>{demo[0].password}</strong>. Fill in as:
								</>
							)}
						</span>
						<div className="flex flex-wrap gap-2">
							{demo.map((account) => (
								<Button
									key={account.email}
									type="button"
									size="sm"
									variant="outline"
									title={account.email}
									onClick={() => {
										setEmail(account.email);
										setPassword(account.password);
									}}
								>
									{demo.length === 1 ? "Fill in" : roleLabel(account)}
								</Button>
							))}
						</div>
					</AlertDescription>
				</Alert>
			)}

			{locked ? (
				<p className="text-center text-sm font-medium break-all" data-testid="locked-email">
					{lockedEmail}
				</p>
			) : (
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
			)}

			<div className="space-y-2">
				<Label htmlFor="password">Password</Label>
				<div className="relative">
					<Input
						ref={passwordRef}
						id="password"
						type={showPassword ? "text" : "password"}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						disabled={isLoading}
						required
						autoFocus={locked}
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

			{(!isDemo || locked) && <div className="flex justify-between items-center text-sm">
				{!isDemo ? <button
					type="button"
					onClick={() => {
						if (!locked) return navigate(`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`);
						// A full navigation: held requests die with the page, so ask first, and
						// the browser's own prompt must not ask again.
						if (!confirmAndDiscardForNavigation()) return;
						window.location.assign(`/forgot-password?email=${encodeURIComponent(lockedEmail)}`);
					}}
					className="text-primary hover:underline bg-transparent border-none p-0 cursor-pointer"
				>
					Forgot password?
				</button> : <span />}
				{locked ? lockedFooter : showSignupLink && (
					<div className="text-muted-foreground">
						Don't have an account?{"  "}
						<button
							type="button"
							onClick={() => navigate("/signup")}
							className="text-primary hover:underline bg-transparent border-none p-0 cursor-pointer"
						>
							Sign up
						</button>
					</div>
				)}
			</div>}

			<div className="flex justify-center">
				<Button type="submit" className="w-1/2 mt-2 mb-2" disabled={isLoading}>
					{isLoading ? "Signing in..." : "Sign In"}
				</Button>
			</div>

			{features?.google && !isDemo && !locked && (
				<>
					<div className="relative my-4">
						<div className="absolute inset-0 flex items-center">
							<span className="w-full border-t" />
						</div>
						<div className="relative flex justify-center text-xs uppercase">
							<span className="bg-background px-2 text-muted-foreground">Or</span>
						</div>
					</div>

					<div className="flex justify-center">
						<GoogleSignInButton
							className="w-1/2"
							disabled={isLoading}
							onError={(err) => setError(err)}
						/>
					</div>
				</>
			)}
		</form>
	);
}
