import { useState } from "react";
import { Button } from "@/components/ui/button";

interface RetrySendEmailProps {
	onResend: () => Promise<void>;
	successMessage?: string;
}

export function RetrySendEmail({
	onResend,
	successMessage = "Email sent! Check your inbox.",
}: RetrySendEmailProps) {
	const [isResending, setIsResending] = useState(false);
	const [resendSuccess, setResendSuccess] = useState(false);

	const handleResend = async () => {
		if (isResending) return;

		setIsResending(true);
		setResendSuccess(false);

		try {
			await onResend();
			setResendSuccess(true);
		} catch {
			// Silently fail - we don't want to reveal if the email exists
			setResendSuccess(true);
		} finally {
			setIsResending(false);
		}
	};

	return (
		<div className="text-center space-y-2">
			{isResending ? (
				<p className="text-sm text-blue-600 dark:text-blue-400">
					Sending email...
				</p>
			) : resendSuccess ? (
				<p className="text-sm text-green-600 dark:text-green-400">
					{successMessage}
				</p>
			) : (
				<p className="text-sm text-muted-foreground">
					Didn't receive the email? Check your spam folder or
				</p>
			)}
			<Button
				variant="outline"
				size="sm"
				onClick={handleResend}
				disabled={isResending}
			>
				{isResending ? "Sending..." : "Resend email"}
			</Button>
		</div>
	);
}
