import { ReactNode } from "react";
import { authClient } from "@/lib/auth/client";
import { useSessionEnded } from "@/lib/auth/session-ended";
import { AuthOverlay } from "./AuthOverlay";
import { SessionEndedDialog } from "./SessionEndedDialog";

interface ProtectedRouteProps {
	children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
	const { data: session, isPending } = authClient.useSession();
	const ended = useSessionEnded();

	if (isPending) {
		return null;
	}

	// No session data at all: a fresh load without a session.
	if (!session) {
		return <AuthOverlay />;
	}

	// `children` keeps its position whether or not the dialog renders, so the page is not remounted
	// and keeps what was typed into it.
	return (
		<>
			{children}
			{ended ? <SessionEndedDialog /> : null}
		</>
	);
}
