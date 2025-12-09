import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";
import { CheckCircle2, AlertCircle } from "lucide-react";

const signUpSchema = z.object({
	name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
	email: z.string().email("Please enter a valid email address"),
	password: z.string().min(8, "Password must be at least 8 characters"),
});

type SignUpFormData = z.infer<typeof signUpSchema>;

export function SignUp() {
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [isLoading, setIsLoading] = useState(false);

	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<SignUpFormData>({
		resolver: zodResolver(signUpSchema),
	});

	const onSubmit = async (data: SignUpFormData) => {
		setError(null);
		setSuccess(false);
		setIsLoading(true);

		try {
			const result = await authClient.signUp.email({
				name: data.name,
				email: data.email,
				password: data.password,
				callbackURL: "/",
			});

			if (result.error) {
				setError(result.error.message || "Failed to create account. Please try again.");
			} else {
				setSuccess(true);
			}
		} catch (err) {
			const e = err as Error;
			setError(e.message || "An unexpected error occurred. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	if (success) {
		return (
			<div className="min-h-screen flex items-center justify-center p-4">
				<div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900" />
				<Card className="relative w-full max-w-md shadow-2xl">
					<CardHeader className="space-y-4 text-center">
						<CardTitle>Verification email sent</CardTitle>
						<CardDescription>We've sent a verification link to your email address</CardDescription>
					</CardHeader>
					<CardContent>
						<Alert>
							<CheckCircle2 className="h-4 w-4" />
							<AlertDescription>
								Please check your inbox and click the verification link to activate your account.
								You'll be automatically signed in after verification.
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
				<CardHeader className="space-y-4 text-center">
					<div>
						<CardTitle>Sign Up</CardTitle>
						<CardDescription>Create a new account to get started</CardDescription>
					</div>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
						{error && (
							<Alert variant="destructive">
								<AlertCircle className="h-4 w-4" />
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						)}

						<div className="space-y-2">
							<Label htmlFor="name">Name</Label>
							<Input id="name" type="text" placeholder="John Doe" {...register("name")} disabled={isLoading} />
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
							<Input id="password" type="password" {...register("password")} disabled={isLoading} />
							{errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
							<p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
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
