import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
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
import { CheckCircle2, AlertCircle } from "lucide-react";
import { config } from "../../../config";

const forgotPasswordSchema = z.object({
	email: z.string().email("Please enter a valid email address"),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

export function ForgotPassword() {
	const [searchParams] = useSearchParams();
	const initialEmail = searchParams.get("email") || "";
	
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [successEmail, setSuccessEmail] = useState("");
	const [isLoading, setIsLoading] = useState(false);

	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<ForgotPasswordFormData>({
		resolver: zodResolver(forgotPasswordSchema),
		defaultValues: {
			email: initialEmail,
		},
	});

	const onSubmit = async (data: ForgotPasswordFormData) => {
		setError(null);
		setSuccess(false);
		setIsLoading(true);

		try {
			const result = await authClient.requestPasswordReset({
				email: data.email,
				redirectTo: "/reset-password",
			});

			if (result.error) {
				setError(result.error.message || "Failed to send reset email. Please try again.");
			} else {
				setSuccessEmail(data.email);
				setSuccess(true);
			}
		} catch (err) {
			const e = err as Error;
			setError(e.message || "An unexpected error occurred. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	const handleResendResetEmail = async () => {
		await authClient.requestPasswordReset({
			email: successEmail,
			redirectTo: "/reset-password",
		});
	};

	if (success) {
		return (
			<div className="min-h-screen flex items-center justify-center p-4">
				<div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900" />

				<Card className="relative w-full max-w-md shadow-2xl">
					<CardHeader className="space-y-4">
						<div className="flex justify-center">
							<Logo className="h-12 w-auto" />
						</div>
						<CardTitle className="text-center">Check your email</CardTitle>
						<CardDescription className="text-center">We've sent a password reset link to your email</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<Alert className="border-green-500 bg-green-50 dark:bg-green-950">
							<CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
							<AlertDescription className="text-green-800 dark:text-green-200">
								Please check your inbox and click the reset link to set a new password. The link will expire in 1 hour.
							</AlertDescription>
						</Alert>
						<RetrySendEmail
							onResend={handleResendResetEmail}
							successMessage="Password reset email sent! Check your inbox."
						/>
					</CardContent>
					<CardFooter className="flex justify-center">
						<Link to="/" className="text-sm text-primary hover:underline">
							Proceed to {config.appName}
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
						<CardTitle>Forgot password?</CardTitle>
						<CardDescription>Enter your email and we'll send you a reset link</CardDescription>
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
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								type="email"
								placeholder="you@example.com"
								{...register("email")}
								disabled={isLoading}
								autoFocus
							/>
							{errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
						</div>

						<Button type="submit" className="w-full" disabled={isLoading}>
							{isLoading ? "Sending..." : "Send reset link"}
						</Button>
					</form>
				</CardContent>
				<CardFooter className="flex justify-center">
					<p className="text-sm text-muted-foreground">
						Remember your password?{" "}
						<Link to="/" className="text-primary hover:underline">
							Sign in
						</Link>
					</p>
				</CardFooter>
			</Card>
		</div>
	);
}






