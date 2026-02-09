// Probe QuestDB to determine the correct device-id column name for queries
const CACHE_KEY = "envirosync_device_column";

// Get table name from environment variable
export function getTableName() {
	if (typeof window !== "undefined") {
		// Client-side: use import.meta.env
		return import.meta.env.VITE_TABLE_NAME || "thesis.csv";
	}
	// Server-side: will be handled by server component
	return "thesis.csv";
}

function quoteIdentifier(name) {
	// quote if contains non-lowercase-underscore-alphanum
	if (/^[a-z_][a-z0-9_]*$/.test(name)) return name;
	return `"${name.replace(/"/g, '""')}"`;
}

async function probeColumns() {
	try {
		const tableName = getTableName();
		const probeQuery = `SELECT * FROM "${tableName}" LIMIT 1`;
		const resp = await fetch(`/api/questdb?query=${encodeURIComponent(probeQuery)}`);
		if (!resp.ok) return null;
		const data = await resp.json();
		if (!data || !data.columns) return null;
		return data.columns.map((c) => c.name);
	} catch (e) {
		console.warn("questdbHelpers: probe failed", e);
		return null;
	}
}

export async function getDeviceColumnName() {
	// check in-memory
	if (window.__envirosync_device_column) return window.__envirosync_device_column;

	// check localStorage cache
	try {
		const cached = localStorage.getItem(CACHE_KEY);
		if (cached) {
			window.__envirosync_device_column = cached;
			return cached;
		}
	} catch (e) {}

	const cols = await probeColumns();
	const candidates = ["device_id", "deviceId", "device", "dev_id", "id", "device_name", "device-name", "mac", "deviceid"];
	if (cols && cols.length > 0) {
		// find exact case-insensitive match
		for (const cand of candidates) {
			const found = cols.find((c) => c.toLowerCase() === cand.toLowerCase());
			if (found) {
				window.__envirosync_device_column = found;
				try {
					localStorage.setItem(CACHE_KEY, found);
				} catch (e) {}
				return found;
			}
		}

		// fallback: pick first column containing 'device' or 'id'
		const byDevice = cols.find((c) => c.toLowerCase().includes("device"));
		if (byDevice) {
			window.__envirosync_device_column = byDevice;
			try {
				localStorage.setItem(CACHE_KEY, byDevice);
			} catch (e) {}
			return byDevice;
		}

		const byId = cols.find((c) => c.toLowerCase().includes("id"));
		if (byId) {
			window.__envirosync_device_column = byId;
			try {
				localStorage.setItem(CACHE_KEY, byId);
			} catch (e) {}
			return byId;
		}
	}

	// last resort
	window.__envirosync_device_column = "device_id";
	return "device_id";
}

export function getQuotedColumn(col) {
	return quoteIdentifier(col);
}
