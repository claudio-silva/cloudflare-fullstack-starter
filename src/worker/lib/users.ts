import bcrypt from "bcryptjs";
import type { Kysely } from "kysely";
import type { Database } from "../types/database";
import { dbBool, dbNow } from "../db";
import { recordSessionEnds } from "./login-log";
import { ROLES, hasRole, type Role } from "../../shared/roles";

/**
 * User writes shared by the auth CLI (routes/cli.ts), the profile page and
 * any user management (such as the example admin area). Better Auth owns sign-up and sign-in;
 * these cover what it leaves to an administrator.
 */

type Db = Kysely<Database>;

/** Roles that may open the admin area. */
const ADMIN_ROLES = ROLES.filter((role) => hasRole(role, "admin"));

/** Creates a user who signs in with email and password. Returns the new id. */
export async function createPasswordUser(
	db: Db,
	input: { email: string; password: string; name?: string | null; role?: Role; emailVerified?: boolean },
): Promise<string> {
	const now = dbNow();
	const userId = crypto.randomUUID();
	await db
		.insertInto("users")
		.values({
			id: userId,
			email: input.email,
			name: input.name || null,
			image: null,
			emailVerified: dbBool(input.emailVerified ?? true),
			createdAt: now,
			updatedAt: now,
			role: input.role ?? "user",
		})
		.execute();
	await setPassword(db, { id: userId, email: input.email }, input.password);
	return userId;
}

/**
 * Sets the user's password, creating the credential account when the user had
 * none (signed up with Google, say), so they can then sign in with it too.
 */
export async function setPassword(db: Db, user: { id: string; email: string }, password: string): Promise<void> {
	const hashed = await bcrypt.hash(password, 10);
	const now = dbNow();
	const existing = await db
		.selectFrom("accounts")
		.where("userId", "=", user.id)
		.where("providerId", "=", "credential")
		.select("accountId")
		.executeTakeFirst();
	if (existing) {
		await db
			.updateTable("accounts")
			.set({ password: hashed, updatedAt: now })
			.where("userId", "=", user.id)
			.where("providerId", "=", "credential")
			.execute();
		return;
	}
	await db
		.insertInto("accounts")
		.values({
			// For a password account Better Auth stores the user's own id as accountId,
			// and looks the credential up by it: any other value and the user exists
			// but can never sign in.
			accountId: user.id,
			id: crypto.randomUUID(),
			userId: user.id,
			providerId: "credential",
			provider: "credential",
			providerAccountId: user.email,
			password: hashed,
			refreshToken: null,
			accessToken: null,
			accessTokenExpiresAt: null,
			scope: null,
			createdAt: now,
			updatedAt: now,
		})
		.execute();
}

/** Deletes the user with everything that refers to them. */
export async function deleteUser(db: Db, user: { id: string; email: string }): Promise<void> {
	await db.deleteFrom("sessions").where("userId", "=", user.id).execute();
	await db.deleteFrom("verifications").where("identifier", "=", user.email).execute();
	await db.deleteFrom("accounts").where("userId", "=", user.id).execute();
	await db.deleteFrom("users").where("id", "=", user.id).execute();
}

/** Signs the user out everywhere. */
export async function revokeSessions(db: Db, userId: string): Promise<void> {
	const sessions = await db.selectFrom("sessions").select(["userId", "ipAddress", "userAgent", "expiresAt"]).where("userId", "=", userId).execute();
	await db.deleteFrom("sessions").where("userId", "=", userId).execute();
	await recordSessionEnds(db, sessions, "session-revoked");
}

/**
 * Whether giving `user` the role `newRole` (or deleting them, with `null`)
 * would leave nobody who can open the admin area.
 */
export async function wouldRemoveLastAdmin(db: Db, user: { role: string }, newRole: string | null): Promise<boolean> {
	if (!hasRole(user.role, "admin") || (newRole !== null && hasRole(newRole, "admin"))) return false;
	const admins = await db
		.selectFrom("users")
		.where("role", "in", ADMIN_ROLES)
		.select((eb) => eb.fn.count<number>("id").as("c"))
		.executeTakeFirst();
	return Number(admins?.c ?? 0) <= 1;
}
