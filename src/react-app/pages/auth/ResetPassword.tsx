import { useState, useRef } from "react";
import { Link, useSearchParams, useNavigate, useParams } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { authClient } from "@/lib/auth/client";
import { CheckCircle2, AlertCircle, Eye, EyeOff } from "lucide-react";

const resetPasswordSchema = z.object({
	password: z.string().min(8, "Password must be at least 8 characters"),
	confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
}).refine((data) => data.password === data.confirmPassword, {
	message: "Passwords do not match",
	path: ["confirmPassword"],
});

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export function ResetPassword() {
	const [searchParams] = useSearchParams();
	const { token: pathToken } = useParams<{ token?: string }>();
	const navigate = useNavigate();
	// Token can come from URL path (/reset-password/:token) or query param (?token=...)
	const token = pathToken || searchParams.get("token");
	const email = searchParams.get("email");
	
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);
	const passwordRef = useRef<HTMLInputElement>(null);
	const confirmPasswordRef = useRef<HTMLInputElement>(null);

	const {
		handleSubmit,
		control,
		formState: { errors },
	} = useForm<ResetPasswordFormData>({
		resolver: zodResolver(resetPasswordSchema),
	});

	const onSubmit = async (data: ResetPasswordFormData) => {
		if (!token) {
			setError("Invalid or missing reset token. Please request a new password reset link.");
			return;
		}

		setError(null);
		setSuccess(false);
		setIsLoading(true);

		try {
			const result = await authClient.resetPassword({
				newPassword: data.password,
				token,
			});

			if (result.error) {
				if (result.error.message?.includes("expired") || result.error.message?.includes("invalid")) {
					setError("This reset link has expired or is invalid. Please request a new one.");
				} else {
					setError(result.error.message || "Failed to reset password. Please try again.");
				}
			} else {
				// Try to auto sign-in if we have the email
				if (email) {
					const signInResult = await authClient.signIn.email({
						email,
						password: data.password,
					});
					
					if (!signInResult.error) {
						// Successfully signed in, redirect to home
						setSuccess(true);
						setTimeout(() => {
							window.location.href = "/";
						}, 1500);
						return;
					}
				}
				
				// Fallback: show success and redirect to login
				setSuccess(true);
				setTimeout(() => navigate("/"), 3000);
			}
		} catch (err) {
			const e = err as Error;
			setError(e.message || "An unexpected error occurred. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	if (!token) {
		return (
			<div className="min-h-screen flex items-center justify-center p-4">
				<div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900" />

				<Card className="relative w-full max-w-md shadow-2xl">
					<CardHeader className="space-y-4">
						<div className="flex justify-center">
							<Logo className="h-12 w-auto" />
						</div>
						<CardTitle className="text-center">Invalid link</CardTitle>
					</CardHeader>
					<CardContent>
						<Alert variant="destructive" className="bg-red-50 dark:bg-red-950 border-red-500">
							<AlertCircle className="h-4 w-4" />
							<AlertDescription className="text-red-800 dark:text-red-200">
								This password reset link is invalid or has expired. Please request a new one.
							</AlertDescription>
						</Alert>
					</CardContent>
					<CardFooter className="flex justify-center">
						<Link to="/forgot-password" className="text-sm text-primary hover:underline">
							Request new reset link
						</Link>
					</CardFooter>
				</Card>
			</div>
		);
	}

	if (success) {
		return (
			<div className="min-h-screen flex items-center justify-center p-4">
				<div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900" />

				<Card className="relative w-full max-w-md shadow-2xl">
					<CardHeader className="space-y-4">
						<div className="flex justify-center">
							<Logo className="h-12 w-auto" />
						</div>
						<CardTitle className="text-center">Password reset successful</CardTitle>
					</CardHeader>
					<CardContent>
						<Alert className="border-green-500 bg-green-50 dark:bg-green-950">
							<CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
							<AlertDescription className="text-green-800 dark:text-green-200">
								Your password has been reset successfully. Redirecting...
							</AlertDescription>
						</Alert>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="min-h-screen flex items-center justify-center p-4">
			<div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900" />

			<Card className="relative w-full max-w-md shadow-2xl">
				<CardHeader className="space-y-4">
					<div className="flex justify-center">
						<Logo className="h-12 w-auto" />
					</div>
					<div className="text-center">
						<CardTitle>Set new password</CardTitle>
						<CardDescription>Enter your new password below</CardDescription>
					</div>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
						{error && (
							<Alert variant="destructive" className="bg-red-50 dark:bg-red-950 border-red-500">
								<AlertCircle className="h-4 w-4" />
								<AlertDescription className="text-red-800 dark:text-red-200">{error}</AlertDescription>
							</Alert>
						)}

						<div className="space-y-2">
							<Label htmlFor="password">New Password</Label>
							<div className="relative">
								<Controller
									name="password"
									control={control}
									render={({ field: { ref, ...field } }) => (
										<Input
											{...field}
											ref={(e) => {
												ref(e);
												passwordRef.current = e;
											}}
											id="password"
											type={showPassword ? "text" : "password"}
											disabled={isLoading}
											className="pr-10"
											autoFocus
										/>
									)}
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
							{errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
							<p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="confirmPassword">Confirm Password</Label>
							<div className="relative">
								<Controller
									name="confirmPassword"
									control={control}
									render={({ field: { ref, ...field } }) => (
										<Input
											{...field}
											ref={(e) => {
												ref(e);
												confirmPasswordRef.current = e;
											}}
											id="confirmPassword"
											type={showConfirmPassword ? "text" : "password"}
											disabled={isLoading}
											className="pr-10"
										/>
									)}
								/>
								<button
									type="button"
									onClick={() => {
										setShowConfirmPassword(!showConfirmPassword);
										confirmPasswordRef.current?.focus();
										// Set cursor to end of text
										setTimeout(() => {
											if (confirmPasswordRef.current) {
												const len = confirmPasswordRef.current.value.length;
												confirmPasswordRef.current.setSelectionRange(len, len);
											}
										}, 0);
									}}
									className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
									tabIndex={-1}
								>
									{showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
								</button>
							</div>
							{errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
						</div>

						<Button type="submit" className="w-full" disabled={isLoading}>
							{isLoading ? "Resetting..." : "Reset password"}
						</Button>
					</form>
				</CardContent>
				<CardFooter className="flex justify-center">
					<Link to="/" className="text-sm text-primary hover:underline">
						Back to sign in
					</Link>
				</CardFooter>
			</Card>
		</div>
	);
}






