<script>
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { createEventDispatcher, onDestroy, onMount } from "svelte";

	const dispatch = createEventDispatcher();

	let earthquakeDetections = [];
	let loading = true;
	let refreshInterval;
	export let hasEarthquakes = false;

	async function fetchEarthquakeDetections() {
		try {
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();

			// Load settings from localStorage
			const savedSettings = localStorage.getItem("enviroSyncSettings");
			const settings = savedSettings
				? JSON.parse(savedSettings)
				: {
						weakEarthquakeThreshold: 0.01,
						strongEarthquakeThreshold: 0.1,
					};

			// Get all devices that currently have quake_flag = 2 with their latest RMS values
			// Check last 24 hours to determine if card should be shown
			const query = `
				SELECT ${deviceCol} as device, ts, rms 
				FROM ${tableName} 
				WHERE quake_flag = 2 
				AND ts > dateadd('h', -24, now())
				ORDER BY ts DESC
			`;

			const response = await fetch(`/api/questdb?query=${encodeURIComponent(query)}`);

			if (response.ok) {
				const result = await response.json();
				if (result.dataset && result.dataset.length > 0) {
					hasEarthquakes = true;
					// Group by device and get the latest detection for each from last 24 hours
					const deviceMap = new Map();

					result.dataset.forEach(([device, timestamp, rms]) => {
						if (!deviceMap.has(device)) {
							const timestampStr = timestamp.replace("Z", "");
							const date = new Date(timestampStr);
							const rmsValue = parseFloat(rms);

							// Determine intensity based on thresholds
							let intensity = "Weak";
							if (rmsValue >= settings.strongEarthquakeThreshold) {
								intensity = "Strong";
							} else if (rmsValue >= settings.weakEarthquakeThreshold) {
								intensity = "Moderate";
							}

							deviceMap.set(device, {
								device,
								timestamp: date,
								rms: rmsValue,
								intensity,
								formattedTime: date.toLocaleString("en-US", {
									month: "short",
									day: "numeric",
									hour: "numeric",
									minute: "2-digit",
									hour12: true,
								}),
							});
						}
					});

					earthquakeDetections = Array.from(deviceMap.values());
				} else {
					hasEarthquakes = false;
					earthquakeDetections = [];
				}
			}
		} catch (error) {
			console.error("Error fetching earthquake detections:", error);
			hasEarthquakes = false;
			earthquakeDetections = [];
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		fetchEarthquakeDetections();
		// Refresh every 3 seconds
		refreshInterval = setInterval(fetchEarthquakeDetections, 3000);
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

	{#if loading}
		<div class="loading">Loading...</div>
	{:else if earthquakeDetections.length === 0}
		<div class="metric-value earthquake">No earthquakes detected</div>
	{:else}
		<div class="detections-list">
			{#each earthquakeDetections as detection}
				<div class="detection-item {detection.intensity.toLowerCase()}">
					<span class="intensity-badge {detection.intensity.toLowerCase()}">{detection.intensity}</span>
					<div class="detection-time">{detection.formattedTime}</div>
				</div>
			{/each}
		</div>
	{/if}
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
		max-height: 400px;
		overflow-y: auto;
	}

	.device-header h3 {
		font-size: 1.8rem;
		font-weight: 600;
		margin: 0;
		color: #fff;
		text-align: center;
	}

	.loading {
		font-size: 1.2rem;
		color: #888;
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

	.detections-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-height: 280px;
		overflow-y: auto;
	}

	.detection-item {
		background: rgba(0, 0, 0, 0.3);
		border-radius: 8px;
		padding: 1rem;
		border-left: 4px solid;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.detection-item.weak {
		border-left-color: #4caf50;
	}

	.detection-item.moderate {
		border-left-color: #ff9800;
	}

	.detection-item.strong {
		border-left-color: #f44336;
	}

	.intensity-badge {
		padding: 0.4rem 1rem;
		border-radius: 12px;
		font-size: 1rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.intensity-badge.weak {
		background: rgba(76, 175, 80, 0.2);
		color: #4caf50;
	}

	.intensity-badge.moderate {
		background: rgba(255, 152, 0, 0.2);
		color: #ff9800;
	}

	.intensity-badge.strong {
		background: rgba(244, 67, 54, 0.2);
		color: #f44336;
	}

	.detection-time {
		font-size: 0.9rem;
		color: #b0b0b0;
	}

	/* Custom scrollbar for detections list */
	.detections-list::-webkit-scrollbar {
		width: 6px;
	}

	.detections-list::-webkit-scrollbar-track {
		background: rgba(0, 0, 0, 0.2);
		border-radius: 3px;
	}

	.detections-list::-webkit-scrollbar-thumb {
		background: rgba(156, 39, 176, 0.5);
		border-radius: 3px;
	}

	.detections-list::-webkit-scrollbar-thumb:hover {
		background: rgba(156, 39, 176, 0.7);
	}
</style>
