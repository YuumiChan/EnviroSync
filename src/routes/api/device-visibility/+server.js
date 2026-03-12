import { getDb } from "$lib/server/db.js";
import { json } from "@sveltejs/kit";

/** @type {import('./$types').RequestHandler} */
export async function GET({ locals }) {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const db = getDb();
	const rows = db.prepare("SELECT device_id FROM hidden_devices WHERE user_id = ?").all(locals.user.id);
	const hiddenDevices = rows.map((r) => r.device_id);

	return json({ hiddenDevices });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const { hiddenDevices } = await request.json();

	if (!Array.isArray(hiddenDevices)) {
		return json({ error: "hiddenDevices must be an array" }, { status: 400 });
	}

	const db = getDb();

	// Replace all hidden devices for this user in a transaction
	const updateHidden = db.transaction(() => {
		db.prepare("DELETE FROM hidden_devices WHERE user_id = ?").run(locals.user.id);
		const insert = db.prepare("INSERT INTO hidden_devices (user_id, device_id) VALUES (?, ?)");
		for (const deviceId of hiddenDevices) {
			insert.run(locals.user.id, deviceId);
		}
	});

	updateHidden();

	return json({ success: true, hiddenDevices });
}
