import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import { resolve } from "path";

const DB_PATH = resolve("data", "envirosync.db");

let db;

/**
 * Get or initialize the SQLite database connection.
 * Creates tables and a default admin user if needed.
 */
export function getDb() {
	if (!db) {
		const dir = resolve("data");
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		db = new Database(DB_PATH);
		db.pragma("journal_mode = WAL");

		db.exec(`
			CREATE TABLE IF NOT EXISTS users (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				username TEXT UNIQUE NOT NULL,
				password_hash TEXT NOT NULL,
				salt TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);

			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				expires_at DATETIME NOT NULL,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);
		`);

		// Create default admin user if no users exist
		const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
		if (userCount.count === 0) {
			const salt = crypto.randomBytes(16).toString("hex");
			const hash = crypto.pbkdf2Sync("admin", salt, 10000, 64, "sha512").toString("hex");
			db.prepare("INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)").run("admin", hash, salt);
			console.log("Default admin user created (username: admin, password: admin)");
		}
	}
	return db;
}

/** Hash a password with a given salt */
export function hashPassword(password, salt) {
	return crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
}

/** Generate a random salt */
export function generateSalt() {
	return crypto.randomBytes(16).toString("hex");
}

/** Generate a session token */
export function generateSessionId() {
	return crypto.randomBytes(32).toString("hex");
}

/** Verify a password against stored hash */
export function verifyPassword(password, storedHash, salt) {
	const hash = hashPassword(password, salt);
	return hash === storedHash;
}

/** Create a new session for a user (expires in 7 days) */
export function createSession(userId) {
	const database = getDb();
	const sessionId = generateSessionId();
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
	database.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(sessionId, userId, expiresAt);
	return sessionId;
}

/** Validate a session and return the user if valid */
export function validateSession(sessionId) {
	if (!sessionId) return null;
	const database = getDb();
	const session = database
		.prepare(
			`
		SELECT s.*, u.username, u.id as uid
		FROM sessions s
		JOIN users u ON s.user_id = u.id
		WHERE s.id = ? AND s.expires_at > datetime('now')
	`,
		)
		.get(sessionId);

	if (!session) return null;
	return { id: session.uid, username: session.username };
}

/** Delete a session */
export function deleteSession(sessionId) {
	const database = getDb();
	database.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

/** Delete all sessions for a user */
export function deleteUserSessions(userId) {
	const database = getDb();
	database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/** Clean up expired sessions */
export function cleanExpiredSessions() {
	const database = getDb();
	database.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}
