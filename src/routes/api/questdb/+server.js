import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";

const QUESTDB_URL = env.API_BASE_URL || "https://questdb.justpi.tech";
const TABLE_NAME = env.TABLE_NAME || "thesis_testing";

// Export for use in other modules
export const config = {
	QUESTDB_URL,
	TABLE_NAME,
};

export async function GET({ url, setHeaders }) {
	try {
		const query = url.searchParams.get("query");

		if (!query) {
			return json({ error: "Query parameter is required" }, { status: 400 });
		}

		console.log("Server: Executing query:", query);

		const questUrl = `${QUESTDB_URL}/exec?query=${encodeURIComponent(query)}`;
		console.log("Server: Fetching from:", questUrl);

		const response = await fetch(questUrl);

		if (!response.ok) {
			const body = await response.text().catch(() => "<unreadable body>");
			console.error("Server: QuestDB non-OK response body:", body);
			throw new Error(`QuestDB returned ${response.status}: ${body}`);
		}

		let data;
		try {
			data = await response.json();
		} catch (parseError) {
			const text = await response.text().catch(() => "<unreadable body>");
			console.error("Server: Failed to parse QuestDB JSON response:", text);
			throw new Error(`Invalid JSON from QuestDB: ${text}`);
		}

		console.log("Server: QuestDB response:", data);

		// Set cache headers for better performance
		setHeaders({
			"Cache-Control": "public, max-age=60, s-maxage=120", // Cache for 1-2 minutes
			Vary: "Accept-Encoding",
			"Content-Type": "application/json",
		});

		return json(data);
	} catch (error) {
		console.error("Server: Error fetching from QuestDB:", error);

		// Set no-cache headers for errors
		setHeaders({
			"Cache-Control": "no-cache, no-store, must-revalidate",
		});

		return json({ error: error.message }, { status: 500 });
	}
}
