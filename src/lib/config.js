// Shared configuration for the application
export const config = {
	// Get table name from environment
	getTableName: () => {
		if (typeof import.meta !== "undefined" && import.meta.env) {
			return import.meta.env.VITE_TABLE_NAME || "thesis.csv";
		}
		return "thesis.csv";
	},

	// Get API base URL from environment
	getApiBaseUrl: () => {
		if (typeof import.meta !== "undefined" && import.meta.env) {
			return import.meta.env.VITE_API_BASE_URL || "https://questdb.justpi.tech";
		}
		return "https://questdb.justpi.tech";
	},

	// Auto-refresh intervals
	refreshIntervals: {
		dashboard: 5000, // 5 seconds for dashboard device cards
		metricCards: 2000, // 2 seconds for metric cards
		charts: 60000, // 60 seconds for charts
	},

	// Timezone offset in hours (UTC+8 for Philippines)
	// DB timestamps are stored in local time but QuestDB now() is UTC
	timezoneOffsetHours: 8,
};

/**
 * Returns a SQL expression for "now" adjusted to match the local-time
 * timestamps stored in QuestDB.  Use this instead of bare `now()`.
 */
export function localNow() {
	return `dateadd('h', ${config.timezoneOffsetHours}, now())`;
}
