<script>
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { createEventDispatcher, onDestroy, onMount } from "svelte";

	const dispatch = createEventDispatcher();

	let lastEarthquakeTime = "No earthquakes detected";
	let loading = true;
	let refreshInterval;

	async function fetchLastEarthquake() {
		try {
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();

			// Get last time when quake_flag=2 from any device
			const query = `SELECT ts, ${deviceCol} as device FROM ${tableName} WHERE quake_flag = 2 ORDER BY ts DESC LIMIT 1`;

			const response = await fetch(`/api/questdb?query=${encodeURIComponent(query)}`);

			if (response.ok) {
				const result = await response.json();
				if (result.dataset && result.dataset.length > 0) {
					const [timestamp, device] = result.dataset[0];
					// Treat timestamp as already in local time (UTC+8)
					const timestampStr = timestamp.replace("Z", "");
					const date = new Date(timestampStr);
					lastEarthquakeTime = date.toLocaleString("en-US", {
						month: "short",
						day: "numeric",
						year: "numeric",
						hour: "numeric",
						minute: "2-digit",
						hour12: true,
					});
				} else {
					lastEarthquakeTime = "No earthquakes detected";
				}
			}
		} catch (error) {
			console.error("Error fetching earthquake detection:", error);
			lastEarthquakeTime = "Error loading data";
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		fetchLastEarthquake();
		// Refresh every 3 seconds
		refreshInterval = setInterval(fetchLastEarthquake, 3000);
	});

	onDestroy(() => {
		if (refreshInterval) {
			clearInterval(refreshInterval);
		}
	});
</script>

<div class="earthquake-card">
	<div class="device-header">
		<h3>Earthquake Detection</h3>
	</div>
	<div class="metric-value earthquake">{loading ? "..." : lastEarthquakeTime}</div>
</div>

<style>
	.earthquake-card {
		background: #2d2d2d;
		border: 1px solid #404040;
		border-radius: 12px;
		padding: 2.5rem;
		width: 100%;
		text-align: center;
		color: inherit;
		font-family: inherit;
		transition: all 0.3s ease;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-height: 200px;
	}

	.device-header h3 {
		font-size: 1.8rem;
		font-weight: 600;
		margin: 0;
		color: #fff;
		text-align: center;
	}

	.metric-value {
		font-size: 1.2rem;
		font-weight: bold;
		color: #fff;
		text-align: center;
	}

	.metric-value.earthquake {
		color: #9c27b0;
	}
</style>
