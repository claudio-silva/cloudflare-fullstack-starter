import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, XCircle } from "lucide-react";

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
					}, 1200);
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

	return (
		<div className="min-h-screen flex items-center justify-center p-4">
			<div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900" />
			<Card className="relative w-full max-w-md shadow-2xl">
				<CardHeader className="space-y-4 text-center">
					<CardTitle>Email Verification</CardTitle>
					<CardDescription>
						{status === "loading" && "Verifying your email address..."}
						{status === "success" && "Verification complete"}
						{status === "error" && "Verification failed"}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{status === "loading" && (
						<div className="flex flex-col items-center justify-center py-8">
							<p className="text-sm text-muted-foreground">Verifying...</p>
						</div>
					)}

					{status === "success" && (
						<Alert className="border-green-500 bg-green-50 dark:bg-green-950">
							<CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
							<AlertDescription className="text-green-800 dark:text-green-200">{message}</AlertDescription>
						</Alert>
					)}

					{status === "error" && (
						<Alert variant="destructive">
							<XCircle className="h-4 w-4" />
							<AlertDescription>{message}</AlertDescription>
						</Alert>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
