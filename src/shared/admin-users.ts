import { z } from "zod";
import { ROLES, type Role } from "./roles";

/**
 * The contract of the example admin area's user management
 * (`/api/admin/users`): what the Worker validates and the form checks before
 * sending. Part of the removable admin example; see docs/ADMIN.md.
 */

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
const password = z.string().min(8, "At least 8 characters.").max(128, "At most 128 characters.");

const userFields = z.object({
	name: z.string().trim().max(100, "At most 100 characters."),
	email,
	role: z.enum(ROLES),
	/** Shown as "active": an unverified user cannot sign in while verification is required. */
	emailVerified: z.boolean(),
});

export const createUserSchema = userFields.extend({ password });

/** Every field optional; `password` sets a new one and signs the user out everywhere. */
export const updateUserSchema = userFields.partial().extend({ password: password.optional() });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export type AdminUser = {
	id: string;
	name: string | null;
	email: string;
	role: Role | string;
	emailVerified: boolean;
	createdAt: string;
	updatedAt: string;
};

export type AdminUserDetail = AdminUser & {
	/** Better Auth provider ids: "credential" (password), "google", … */
	signInMethods: string[];
	activeSessions: number;
	lastSignInAt: string | null;
};

export const USER_SORT_FIELDS = ["name", "email", "role", "createdAt"] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export type AdminUserList = {
	users: AdminUser[];
	total: number;
	page: number;
	pageSize: number;
};
