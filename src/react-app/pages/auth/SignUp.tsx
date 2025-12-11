import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
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
import { config } from "../../../config";

const signUpSchema = z.object({
	name: z.string().max(100, "Name must be 100 characters or less").optional().or(z.literal("")),
	email: z.string().email("Please enter a valid email address"),
	password: z.string().min(8, "Password must be at least 8 characters"),
	confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
}).refine((data) => data.password === data.confirmPassword, {
	message: "Passwords do not match",
	path: ["confirmPassword"],
});

type SignUpFormData = z.infer<typeof signUpSchema>;

export function SignUp() {
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const [pendingVerification, setPendingVerification] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);

	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<SignUpFormData>({
		resolver: zodResolver(signUpSchema),
	});

	const onSubmit = async (data: SignUpFormData) => {
		setError(null);
		setPendingVerification(false);
		setIsLoading(true);

		try {
			const result = await authClient.signUp.email({
				name: data.name || "",
				email: data.email,
				password: data.password,
				callbackURL: "/",
			});

			if (result.error) {
				setError(result.error.message || "Failed to create account. Please try again.");
			} else if (result.data) {
				// Check if user was auto-signed-in (local mode, no verification required)
				// In this case, the session will be set and we can redirect
				const session = await authClient.getSession();
				if (session.data?.user) {
					// User is signed in - redirect to home
					navigate("/");
				} else {
					// User needs to verify email first
					setPendingVerification(true);
				}
			}
		} catch (err) {
			const e = err as Error;
			setError(e.message || "An unexpected error occurred. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	if (!config.auth.enableSignups) {
		return <Navigate to="/" replace />;
	}

	if (pendingVerification) {
		return (
			<div className="min-h-screen flex items-center justify-center p-4">
				<div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900" />

			<Card className="relative w-full max-w-md shadow-2xl">
				<CardHeader className="space-y-4">
					<div className="flex justify-center">
						<Logo className="h-12 w-auto" />
					</div>
					<CardTitle className="text-center">Verification email sent</CardTitle>
					<CardDescription className="text-center">We've sent a verification link to your email address</CardDescription>
				</CardHeader>
					<CardContent>
						<Alert className="border-green-500 bg-green-50 dark:bg-green-950">
							<CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
							<AlertDescription className="text-green-800 dark:text-green-200">
								Please check your inbox and click the verification link to activate your account. You'll
								be automatically signed in after verification.
							</AlertDescription>
						</Alert>
						<p className="text-sm text-muted-foreground mt-4">
							Didn't receive the email? Check your spam folder or try signing up again.
						</p>
					</CardContent>
					<CardFooter className="flex justify-center">
						<Link to="/" className="text-sm text-primary hover:underline">
							Back to home
						</Link>
					</CardFooter>
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
						<CardTitle>Sign Up</CardTitle>
						<CardDescription>Create a new account to get started</CardDescription>
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
							<Label htmlFor="name">
								Name <span className="text-muted-foreground font-normal">(optional)</span>
							</Label>
							<Input
								id="name"
								type="text"
								placeholder="John Doe"
								{...register("name")}
								disabled={isLoading}
							/>
							{errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
						</div>

						<div className="space-y-2">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								type="email"
								placeholder="you@example.com"
								{...register("email")}
								disabled={isLoading}
							/>
							{errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
						</div>

						<div className="space-y-2">
							<Label htmlFor="password">Password</Label>
							<div className="relative">
								<Input
									id="password"
									type={showPassword ? "text" : "password"}
									{...register("password")}
									disabled={isLoading}
									className="pr-10"
								/>
								<button
									type="button"
									onClick={() => setShowPassword(!showPassword)}
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
								<Input
									id="confirmPassword"
									type={showConfirmPassword ? "text" : "password"}
									{...register("confirmPassword")}
									disabled={isLoading}
									className="pr-10"
								/>
								<button
									type="button"
									onClick={() => setShowConfirmPassword(!showConfirmPassword)}
									className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
									tabIndex={-1}
								>
									{showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
								</button>
							</div>
							{errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
						</div>

						<Button type="submit" className="w-full" disabled={isLoading}>
							{isLoading ? "Creating account..." : "Create Account"}
						</Button>
					</form>
				</CardContent>
				<CardFooter className="flex justify-center">
					<p className="text-sm text-muted-foreground">
						Already have an account?{" "}
						<Link to="/" className="text-primary hover:underline">
							Sign in
						</Link>
					</p>
				</CardFooter>
			</Card>
		</div>
	);
}
