import { deleteSession } from "$lib/server/db.js";
import { json } from "@sveltejs/kit";

export async function POST({ cookies }) {
	const sessionId = cookies.get("session");
	if (sessionId) {
		deleteSession(sessionId);
		cookies.delete("session", { path: "/" });
	}
	return json({ success: true });
}
