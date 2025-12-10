import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export function VerifyEmail() {
	const [searchParams] = useSearchParams();
	const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
	const [message, setMessage] = useState("");

	useEffect(() => {
		const verifyEmail = async () => {
			try {
				const token = searchParams.get("token");
				if (!token) {
					setStatus("error");
					setMessage("No verification token provided");
					return;
				}

				const response = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=/`, {
					method: "GET",
					credentials: "include",
					redirect: "manual",
				});

				if (response.status === 302 || response.type === "opaqueredirect" || response.ok) {
					setStatus("success");
					setMessage("Email verified successfully! Redirecting...");
					setTimeout(() => {
						window.location.href = "/";
					}, 1500);
				} else {
					const data = await response.json().catch(() => ({}));
					setStatus("error");
					setMessage(data.message || "Failed to verify email. The link may have expired.");
				}
			} catch {
				setStatus("error");
				setMessage("An error occurred during verification. Please try again.");
			}
		};

		verifyEmail();
	}, [searchParams]);

	const getTitle = () => {
		switch (status) {
			case "loading":
				return "Verifying your email";
			case "success":
				return "Email verified";
			case "error":
				return "Verification failed";
		}
	};

	const getDescription = () => {
		switch (status) {
			case "loading":
				return "Please wait while we verify your email address...";
			case "success":
				return "Your account is now active";
			case "error":
				return "We couldn't verify your email";
		}
	};

	return (
		<div className="min-h-screen flex items-center justify-center p-4">
			<div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900" />

			<Card className="relative w-full max-w-md shadow-2xl">
				<CardHeader className="space-y-4">
					<div className="flex justify-center">
						<Logo className="h-12 w-auto" />
					</div>
					<CardTitle className="text-center">{getTitle()}</CardTitle>
					<CardDescription className="text-center">{getDescription()}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{status === "loading" && (
						<div className="flex flex-col items-center justify-center py-8">
							<Loader2 className="h-8 w-8 animate-spin text-primary" />
						</div>
					)}

					{status === "success" && (
						<Alert className="border-green-500 bg-green-50 dark:bg-green-950">
							<CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
							<AlertDescription className="text-green-800 dark:text-green-200">{message}</AlertDescription>
						</Alert>
					)}

					{status === "error" && (
						<Alert variant="destructive" className="bg-red-50 dark:bg-red-950 border-red-500">
							<XCircle className="h-4 w-4" />
							<AlertDescription className="text-red-800 dark:text-red-200">{message}</AlertDescription>
						</Alert>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
