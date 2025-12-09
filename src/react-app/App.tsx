import { Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Home } from "@/pages/Home";
import { Profile } from "@/pages/Profile";
import { SignUp } from "@/pages/auth/SignUp";
import { VerifyEmail } from "@/pages/auth/VerifyEmail";
import "./App.css";

function App() {
	return (
		<Routes>
			<Route path="/signup" element={<SignUp />} />
			<Route path="/verify-email" element={<VerifyEmail />} />

			<Route
				path="/"
				element={
					<ProtectedRoute>
						<AppShell>
							<Home />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/profile"
				element={
					<ProtectedRoute>
						<AppShell>
							<Profile />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="*"
				element={
					<ProtectedRoute>
						<AppShell>
							<Home />
						</AppShell>
					</ProtectedRoute>
				}
			/>
		</Routes>
	);
}

export default App;
