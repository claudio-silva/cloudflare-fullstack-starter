import { ReactNode } from "react";
import { authClient } from "@/lib/auth/client";
import { AuthOverlay } from "./AuthOverlay";

interface ProtectedRouteProps {
	children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return null;
	}

	if (!session) {
		return <AuthOverlay />;
	}

	return <>{children}</>;
}
