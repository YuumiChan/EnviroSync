import { deleteUserSessions, generateSalt, getDb, hashPassword } from "$lib/server/db.js";
import { json } from "@sveltejs/kit";

// Get all users
export async function GET({ locals }) {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const db = getDb();
	const users = db.prepare("SELECT id, username, created_at FROM users ORDER BY created_at ASC").all();
	return json({ users });
}

// Create a new user
export async function POST({ request, locals }) {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const { username, password } = await request.json();

		if (!username || !password) {
			return json({ error: "Username and password are required" }, { status: 400 });
		}

		if (username.length < 3) {
			return json({ error: "Username must be at least 3 characters" }, { status: 400 });
		}

		if (password.length < 4) {
			return json({ error: "Password must be at least 4 characters" }, { status: 400 });
		}

		const db = getDb();

		// Check if username already exists
		const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
		if (existing) {
			return json({ error: "Username already exists" }, { status: 409 });
		}

		const salt = generateSalt();
		const hash = hashPassword(password, salt);
		db.prepare("INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)").run(username, hash, salt);

		return json({ success: true });
	} catch (error) {
		console.error("Create user error:", error);
		return json({ error: "Internal server error" }, { status: 500 });
	}
}

// Update user password
export async function PUT({ request, locals }) {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const { userId, newPassword } = await request.json();

		if (!userId || !newPassword) {
			return json({ error: "User ID and new password are required" }, { status: 400 });
		}

		if (newPassword.length < 4) {
			return json({ error: "Password must be at least 4 characters" }, { status: 400 });
		}

		const db = getDb();
		const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
		if (!user) {
			return json({ error: "User not found" }, { status: 404 });
		}

		const salt = generateSalt();
		const hash = hashPassword(newPassword, salt);
		db.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").run(hash, salt, userId);

		// Invalidate all sessions for this user
		deleteUserSessions(userId);

		return json({ success: true });
	} catch (error) {
		console.error("Update password error:", error);
		return json({ error: "Internal server error" }, { status: 500 });
	}
}

// Delete a user
export async function DELETE({ url, locals }) {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const userId = parseInt(url.searchParams.get("userId"));

		if (!userId) {
			return json({ error: "User ID is required" }, { status: 400 });
		}

		const db = getDb();

		// Check user count - need at least 1 user
		const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
		if (userCount.count <= 1) {
			return json({ error: "Cannot delete the last user" }, { status: 400 });
		}

		const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
		if (!user) {
			return json({ error: "User not found" }, { status: 404 });
		}

		// Delete user sessions first, then user
		deleteUserSessions(userId);
		db.prepare("DELETE FROM users WHERE id = ?").run(userId);

		return json({ success: true });
	} catch (error) {
		console.error("Delete user error:", error);
		return json({ error: "Internal server error" }, { status: 500 });
	}
}
