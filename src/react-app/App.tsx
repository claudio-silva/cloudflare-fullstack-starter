import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { TopBar } from "@/components/TopBar";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Home } from "@/pages/Home";
import { Profile } from "@/pages/Profile";
import { SignUp } from "@/pages/auth/SignUp";
import { VerifyEmail } from "@/pages/auth/VerifyEmail";
import { ForgotPassword } from "@/pages/auth/ForgotPassword";
import { ResetPassword } from "@/pages/auth/ResetPassword";
import { authClient } from "@/lib/auth/client";
import { config } from "../config";
import "./App.css";

function AppContent() {
	const location = useLocation();
	const { data: session } = authClient.useSession();

	// Auth pages don't use the TopBar layout
	const authPages = ["/signup", "/verify-email", "/forgot-password", "/reset-password"];
	const isAuthPage = authPages.some(page => location.pathname.startsWith(page));

	// Only show TopBar if not on an auth page AND user is authenticated
	// This prevents flash of TopBar while checking auth
	const shouldShowTopBar = !isAuthPage && !!session;

	return (
		<Routes>
			{/* Public auth routes - no TopBar */}
			<Route path="/signup" element={<SignUp />} />
			<Route path="/verify-email" element={<VerifyEmail />} />
			<Route path="/forgot-password" element={<ForgotPassword />} />
			<Route path="/reset-password" element={<ResetPassword />} />

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
	// Set document title from config
	useEffect(() => {
		document.title = config.appName;
	}, []);

	return <AppContent />;
}

export default App;
