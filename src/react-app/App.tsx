import { Routes, Route, useLocation } from "react-router-dom";
import { TopBar } from "@/components/TopBar";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Home } from "@/pages/Home";
import { Profile } from "@/pages/Profile";
import { SignUp } from "@/pages/auth/SignUp";
import { VerifyEmail } from "@/pages/auth/VerifyEmail";
import { authClient } from "@/lib/auth/client";
import "./App.css";

function AppContent() {
	const location = useLocation();
	const { data: session } = authClient.useSession();

	// Auth pages don't use the TopBar layout
	const isAuthPage = location.pathname === "/signup" || location.pathname === "/verify-email";

	// Only show TopBar if not on an auth page AND user is authenticated
	// This prevents flash of TopBar while checking auth
	const shouldShowTopBar = !isAuthPage && !!session;

	return (
		<Routes>
			{/* Public auth routes - no TopBar */}
			<Route path="/signup" element={<SignUp />} />
			<Route path="/verify-email" element={<VerifyEmail />} />

			{/* Protected routes with TopBar */}
			<Route
				path="/"
				element={
					<ProtectedRoute>
						{shouldShowTopBar ? (
							<TopBar>
								<Home />
							</TopBar>
						) : (
							<Home />
						)}
					</ProtectedRoute>
				}
			/>
			<Route
				path="/profile"
				element={
					<ProtectedRoute>
						{shouldShowTopBar ? (
							<TopBar>
								<Profile />
							</TopBar>
						) : (
							<Profile />
						)}
					</ProtectedRoute>
				}
			/>
			<Route
				path="*"
				element={
					<ProtectedRoute>
						{shouldShowTopBar ? (
							<TopBar>
								<Home />
							</TopBar>
						) : (
							<Home />
						)}
					</ProtectedRoute>
				}
			/>
		</Routes>
	);
}

function App() {
	return <AppContent />;
}

export default App;
