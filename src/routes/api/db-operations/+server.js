import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";

const QUESTDB_URL = env.API_BASE_URL || "https://questdb.justpi.tech";
const TABLE_NAME = env.TABLE_NAME || "thesis_testing";

async function questdbExec(query) {
	const url = `${QUESTDB_URL}/exec?query=${encodeURIComponent(query)}`;
	console.log("DB Operations: Executing:", query);
	const response = await fetch(url);
	if (!response.ok) {
		const body = await response.text().catch(() => "<unreadable>");
		throw new Error(`QuestDB returned ${response.status}: ${body}`);
	}
	return response.json();
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals, request }) {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const { action, deviceId, thresholds } = await request.json();

		if (action === "delete-device") {
			if (!deviceId) {
				return json({ error: "deviceId is required" }, { status: 400 });
			}

			// QuestDB does not support DELETE. Workaround: recreate table without the device rows.
			// Step 1: Create temp table with all data except the device
			const tempTable = `${TABLE_NAME}_temp_${Date.now()}`;
			await questdbExec(`CREATE TABLE '${tempTable}' AS (SELECT * FROM '${TABLE_NAME}' WHERE device_id != '${deviceId.replace(/'/g, "''")}') timestamp(ts) PARTITION BY DAY`);

			// Step 2: Rename original table to backup
			const backupTable = `${TABLE_NAME}_backup_${Date.now()}`;
			await questdbExec(`RENAME TABLE '${TABLE_NAME}' TO '${backupTable}'`);

			// Step 3: Rename temp table to original name
			await questdbExec(`RENAME TABLE '${tempTable}' TO '${TABLE_NAME}'`);

			// Step 4: Drop backup table
			await questdbExec(`DROP TABLE '${backupTable}'`);

			return json({ success: true, message: `Device '${deviceId}' deleted successfully` });
		}

		if (action === "reset-earthquake") {
			if (!thresholds || !thresholds.rmsEarthquakeThreshold) {
				return json({ error: "thresholds are required" }, { status: 400 });
			}

			const tempTable = `${TABLE_NAME}_temp_${Date.now()}`;
			await questdbExec(`CREATE TABLE '${tempTable}' AS (SELECT * FROM '${TABLE_NAME}' WHERE NOT (quake_flag = 1 or quake_flag = 2 or rms >= ${parseFloat(thresholds.rmsEarthquakeThreshold)})) timestamp(ts) PARTITION BY DAY`);

			const backupTable = `${TABLE_NAME}_backup_${Date.now()}`;
			await questdbExec(`RENAME TABLE '${TABLE_NAME}' TO '${backupTable}'`);
			await questdbExec(`RENAME TABLE '${tempTable}' TO '${TABLE_NAME}'`);
			await questdbExec(`DROP TABLE '${backupTable}'`);

			return json({ success: true, message: "Earthquake data reset successfully" });
		}

		if (action === "reset-severe") {
			if (!thresholds) {
				return json({ error: "thresholds are required" }, { status: 400 });
			}

			const tempSevere = parseFloat(thresholds.tempSevere || 40);
			const humidSevere = parseFloat(thresholds.humidSevere || 90);

			// Remove rows where temp or humidity exceeds severe thresholds
			const tempTable = `${TABLE_NAME}_temp_${Date.now()}`;
			await questdbExec(`CREATE TABLE '${tempTable}' AS (SELECT * FROM '${TABLE_NAME}' WHERE NOT (temp > ${tempSevere} OR humid > ${humidSevere})) timestamp(ts) PARTITION BY DAY`);

			const backupTable = `${TABLE_NAME}_backup_${Date.now()}`;
			await questdbExec(`RENAME TABLE '${TABLE_NAME}' TO '${backupTable}'`);
			await questdbExec(`RENAME TABLE '${tempTable}' TO '${TABLE_NAME}'`);
			await questdbExec(`DROP TABLE '${backupTable}'`);

			return json({ success: true, message: "Severe conditions data reset successfully" });
		}

		if (action === "reset-database") {
			// Delete ALL data from the table but keep the table structure
			const tempTable = `${TABLE_NAME}_temp_${Date.now()}`;
			await questdbExec(`CREATE TABLE '${tempTable}' AS (SELECT * FROM '${TABLE_NAME}' WHERE 1=0) timestamp(ts) PARTITION BY DAY`);

			const backupTable = `${TABLE_NAME}_backup_${Date.now()}`;
			await questdbExec(`RENAME TABLE '${TABLE_NAME}' TO '${backupTable}'`);
			await questdbExec(`RENAME TABLE '${tempTable}' TO '${TABLE_NAME}'`);
			await questdbExec(`DROP TABLE '${backupTable}'`);

			return json({ success: true, message: "Database reset successfully" });
		}

		return json({ error: "Unknown action" }, { status: 400 });
	} catch (error) {
		console.error("DB Operations error:", error);
		return json({ error: error.message }, { status: 500 });
	}
}
