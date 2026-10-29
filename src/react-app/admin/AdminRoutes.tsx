import { Route, Routes } from "react-router-dom";
import { hasRole } from "../../shared/roles";
import { AdminLayout } from "./components/AdminLayout";
import { AdminNotFound, Forbidden } from "./components/StatusMessage";
import { useRole } from "./nav";
import { Dashboard } from "./pages/Dashboard";
import { UserForm } from "./pages/users/UserForm";
import { UserList } from "./pages/users/UserList";

/**
 * Everything under `/admin`, mounted in App.tsx. Admins and superadmins only;
 * a page's own role comes from its menu item (config.ts). The API checks the
 * same on its side (src/worker/routes/admin/).
 */
export function AdminRoutes() {
	if (!hasRole(useRole(), "admin")) return <Forbidden />;

	return (
		<Routes>
			<Route element={<AdminLayout />}>
				<Route index element={<Dashboard />} />
				<Route path="users" element={<UserList />} />
				<Route path="users/new" element={<UserForm />} />
				<Route path="users/:id" element={<UserForm />} />
				<Route path="*" element={<AdminNotFound />} />
			</Route>
		</Routes>
	);
}
