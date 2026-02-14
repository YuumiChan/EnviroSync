import { createSession, getDb, verifyPassword } from "$lib/server/db.js";
import { json } from "@sveltejs/kit";

export async function POST({ request, cookies }) {
	try {
		const { username, password } = await request.json();

		if (!username || !password) {
			return json({ error: "Username and password are required" }, { status: 400 });
		}

		const db = getDb();
		const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

		if (!user) {
			return json({ error: "Invalid username or password" }, { status: 401 });
		}

		const valid = verifyPassword(password, user.password_hash, user.salt);
		if (!valid) {
			return json({ error: "Invalid username or password" }, { status: 401 });
		}

		// Create session
		const sessionId = createSession(user.id);

		// Set session cookie (7 days)
		cookies.set("session", sessionId, {
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
		});

		return json({ success: true, username: user.username });
	} catch (error) {
		console.error("Login error:", error);
		return json({ error: "Internal server error" }, { status: 500 });
	}
}
