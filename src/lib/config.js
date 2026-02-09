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
};
