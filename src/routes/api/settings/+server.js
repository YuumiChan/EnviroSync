import { getDb } from "$lib/server/db.js";
import { json } from "@sveltejs/kit";

/** @type {import('./$types').RequestHandler} */
export async function GET({ locals, url }) {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const type = url.searchParams.get("type");
	const db = getDb();

	if (type === "shared") {
		const row = db.prepare("SELECT settings_json FROM shared_settings WHERE id = 1").get();
		if (row) {
			return json({ settings: JSON.parse(row.settings_json) });
		}
		return json({ settings: null });
	}

	const row = db.prepare("SELECT settings_json FROM user_settings WHERE user_id = ?").get(locals.user.id);

	if (row) {
		return json({ settings: JSON.parse(row.settings_json) });
	}

	return json({ settings: null });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await request.json();
	const db = getDb();

	if (body.type === "shared") {
		const { settings } = body;
		if (!settings || typeof settings !== "object") {
			return json({ error: "settings must be an object" }, { status: 400 });
		}
		const settingsJson = JSON.stringify(settings);
		db.prepare("INSERT INTO shared_settings (id, settings_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json").run(settingsJson);
		return json({ success: true });
	}

	const { settings } = body;

	if (!settings || typeof settings !== "object") {
		return json({ error: "settings must be an object" }, { status: 400 });
	}

	const settingsJson = JSON.stringify(settings);

	db.prepare("INSERT INTO user_settings (user_id, settings_json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json").run(locals.user.id, settingsJson);

	return json({ success: true });
}
