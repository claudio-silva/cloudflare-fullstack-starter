import { useState, useRef } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { RetrySendEmail } from "@/components/auth/RetrySendEmail";
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
	const [pendingEmail, setPendingEmail] = useState<string>("");
	const [isLoading, setIsLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);
	const passwordRef = useRef<HTMLInputElement>(null);
	const confirmPasswordRef = useRef<HTMLInputElement>(null);

	const {
		register,
		handleSubmit,
		control,
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
					setPendingEmail(data.email);
					setPendingVerification(true);
				}
			}
		} catch {
			setError("An unexpected error occurred. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	const handleResendVerification = async () => {
		await authClient.sendVerificationEmail({
			email: pendingEmail,
			callbackURL: "/",
		});
	};

	if (!config.auth.enableSignups) {
		return <Navigate to="/" replace />;
	}

	if (pendingVerification) {
		return (
			<div className="min-h-screen flex flex-col items-center py-4 px-4">
				<div className="fixed inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 -z-10" />

				<Card className="relative w-full max-w-md shadow-2xl my-auto">
					<CardHeader className="space-y-6">
						<div className="flex justify-center">
							<Logo className="h-12 w-auto" showTitle={true} />
						</div>
						<CardTitle className="text-center">Verification email sent</CardTitle>
						<CardDescription className="text-center">We've sent a verification link to your email address</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<Alert className="border-green-500 bg-green-50 dark:bg-green-950">
							<CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
							<AlertDescription className="text-green-800 dark:text-green-200">
								Please check your inbox and click the verification link to activate your account. You'll
								be automatically signed in after verification.
							</AlertDescription>
						</Alert>
						<RetrySendEmail
							onResend={handleResendVerification}
							successMessage="Verification email sent! Check your inbox."
						/>
					</CardContent>
					<CardFooter className="flex justify-center">
						<Button asChild className="w-1/2">
							<Link to="/">
								Proceed to {config.appName}
							</Link>
						</Button>
					</CardFooter>
				</Card>
			</div>
		);
	}

	return (
		<div className="min-h-screen flex flex-col items-center py-4 px-4">
			<div className="fixed inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 -z-10" />

			<Card className="relative w-full max-w-md shadow-2xl my-auto">
				<CardHeader className="space-y-6">
					<div className="flex justify-center">
						<Logo className="h-12 w-auto" showTitle={true} />
					</div>
					<div className="text-center">
						<CardTitle>Sign Up</CardTitle>
						<CardDescription className="mt-2">Create a new account to get started</CardDescription>
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
								autoFocus
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

						<div className="flex justify-center pt-3">
							<Button type="submit" className="w-1/2" disabled={isLoading}>
								{isLoading ? "Creating account..." : "Create Account"}
							</Button>
						</div>
					</form>
				</CardContent>
				<CardFooter className="flex justify-center">
					<p className="text-sm text-muted-foreground">
						Already have an account?{"  "}
						<Link to="/" className="text-primary hover:underline">
							Sign in
						</Link>
					</p>
				</CardFooter>
			</Card>
		</div>
	);
}
