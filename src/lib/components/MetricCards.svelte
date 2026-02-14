<script>
	import { config } from "$lib/config.js";
	import { getTableName } from "$lib/questdbHelpers.js";
	import { onDestroy, onMount } from "svelte";

	export let selectedDevice = "DHT11"; // Default to DHT11 if no device selected

	// Current environmental readings
	let temperature = "29.70"; // 2 decimal places
	let temperatureAvg = "25.52";
	let humidity = "87.0"; // 1 decimal place
	let humidityAvg = "68.99";
	let status = "NORMAL";
	let lastUpdate = "3:00 PM";
	let loading = true;
	let metricsTimeout;

	// Function to fetch current metrics from QuestDB
	async function fetchCurrentMetrics() {
		try {
			console.log(`MetricCards: Attempting to fetch metrics for device: ${selectedDevice}`);

			// Determine device column and build queries
			const deviceColName = await (await import("$lib/questdbHelpers.js")).getDeviceColumnName();
			const deviceCol = (await import("$lib/questdbHelpers.js")).getQuotedColumn(deviceColName);
			const tableName = getTableName();
			// Get current readings (latest record)
			const currentQuery = `SELECT temp, humid, ts FROM ${tableName} WHERE ${deviceCol}='${selectedDevice}' ORDER BY ts DESC LIMIT 1`;

			// Get averages for last 24 hours
			const avgQuery = `SELECT AVG(temp) as temp_avg, AVG(humid) as humid_avg FROM ${tableName} WHERE ${deviceCol}='${selectedDevice}' AND ts > dateadd('h', -24, now())`;

			console.log("Fetching current and average data via proxy...");

			const [currentResponse, avgResponse] = await Promise.all([fetch(`/api/questdb?query=${encodeURIComponent(currentQuery)}`), fetch(`/api/questdb?query=${encodeURIComponent(avgQuery)}`)]);

			console.log("Current response status:", currentResponse.status);
			console.log("Average response status:", avgResponse.status);

			if (currentResponse.ok) {
				const currentResult = await currentResponse.json();
				console.log("Current data:", currentResult);
				if (currentResult.dataset && currentResult.dataset.length > 0) {
					const [temp, humid, timestamp] = currentResult.dataset[0];
					temperature = parseFloat(temp).toFixed(2); // 2 decimal places
					humidity = parseFloat(humid).toFixed(1); // 1 decimal place

					// Treat timestamp as already in local time (UTC+8) - parse as string to avoid conversion
					// The DB returns timestamps like "2026-02-03T10:12:05.000000Z" which is already UTC+8
					const timestampStr = timestamp.replace("Z", ""); // Remove Z to treat as local
					const dbDate = new Date(timestampStr);
					const now = new Date();
					const minutesSinceLastUpdate = (now - dbDate) / 1000 / 60;
					const isOffline = minutesSinceLastUpdate > 5;

					// Format time as 12-hour with AM/PM
					// If offline, show date + time; otherwise just time
					if (isOffline) {
						lastUpdate = dbDate.toLocaleString("en-US", {
							month: "short",
							day: "numeric",
							year: "numeric",
							hour: "numeric",
							minute: "2-digit",
							hour12: true,
						});
						status = "Offline";
					} else {
						lastUpdate = dbDate.toLocaleTimeString("en-US", {
							hour: "numeric",
							minute: "2-digit",
							hour12: true,
						});
						// Determine status based on readings only if not offline
						status = determineStatus(temperature, humidity);
					}
				}
			}

			if (avgResponse.ok) {
				const avgResult = await avgResponse.json();
				console.log("Average data:", avgResult);
				if (avgResult.dataset && avgResult.dataset.length > 0) {
					const [tempAvg, humidAvg] = avgResult.dataset[0];
					temperatureAvg = parseFloat(tempAvg).toFixed(2);
					humidityAvg = parseFloat(humidAvg).toFixed(2);
				}
			}
		} catch (error) {
			console.error("Error fetching metrics:", error);
			console.error("Error details:", error.message);
			console.error("Error name:", error.name);

			// Use default values on error
			temperature = "0.00";
			temperatureAvg = "0.00";
			humidity = "0.0";
			humidityAvg = "0.00";
			status = "ERROR";
			lastUpdate = "N/A";
		} finally {
			loading = false;
		}
	}

	// Function to determine system status
	function determineStatus(temp, humid) {
		const t = parseFloat(temp);
		const h = parseFloat(humid);

		// Load settings from localStorage
		const savedSettings = localStorage.getItem("enviroSyncSettings");
		const settings = savedSettings
			? JSON.parse(savedSettings)
			: {
					tempNormalMin: 18,
					tempNormalMax: 35,
					tempSevere: 40,
					humidNormalMin: 30,
					humidNormalMax: 80,
					humidSevere: 90,
					rmsEarthquakeThreshold: 0.05,
					weakEarthquakeThreshold: 0.01,
					strongEarthquakeThreshold: 0.1,
				};

		// Define normal ranges using settings
		const tempNormal = t >= settings.tempNormalMin && t <= settings.tempNormalMax;
		const humidNormal = h >= settings.humidNormalMin && h <= settings.humidNormalMax;

		if (tempNormal && humidNormal) {
			return "Normal";
		} else if (t > settings.tempSevere || h > settings.humidSevere) {
			return "Severe";
		} else {
			return "Warning";
		}
	}

	// Reactive statement with debounce - update metrics when selectedDevice changes
	$: if (selectedDevice) {
		// Clear previous timeout
		if (metricsTimeout) {
			clearTimeout(metricsTimeout);
		}
		// Debounce the update to prevent rapid requests
		metricsTimeout = setTimeout(() => {
			fetchCurrentMetrics();
		}, 350); // Slightly different delay to stagger requests
	}

	onMount(() => {
		fetchCurrentMetrics();

		// Set up automatic refresh every 1 minute (aligned with chart)
		const interval = setInterval(fetchCurrentMetrics, config.refreshIntervals.metricCards);
		return () => clearInterval(interval);
	});

	onDestroy(() => {
		if (metricsTimeout) {
			clearTimeout(metricsTimeout);
		}
	});

	// Manual refresh function
	async function manualRefresh() {
		await fetchCurrentMetrics();
	}
</script>

<div class="metrics-container">
	<!-- Temperature Card -->
	<div class="metric-card">
		<div class="metric-header">
			<span class="metric-label">Temperature</span>
		</div>
		{#if status === "Offline"}
			<div class="metric-value offline">Offline</div>
		{:else}
			<div class="metric-value temperature">{temperature}°C</div>
			<div class="metric-average">Avg: {temperatureAvg}°C</div>
		{/if}
	</div>

	<!-- Humidity Card -->
	<div class="metric-card">
		<div class="metric-header">
			<span class="metric-label">Humidity</span>
		</div>
		{#if status === "Offline"}
			<div class="metric-value offline">—</div>
		{:else}
			<div class="metric-value humidity">{humidity}%</div>
			<div class="metric-average">Avg: {humidityAvg}%</div>
		{/if}
	</div>

	<!-- Status Card -->
	<div class="metric-card">
		<div class="metric-header">
			<span class="metric-label">Status</span>
		</div>
		<div class="metric-value status-indicator {status.toLowerCase()}">{status}</div>
		{#if status !== "Offline"}
			<div class="metric-average">Last Update: {lastUpdate}</div>
		{/if}
	</div>
</div>

<style>
	.metrics-container {
		display: contents;
	}

	.metric-card {
		background: rgba(0, 0, 0, 0.3);
		border-radius: 8px;
		padding: 1rem;
		border: 1px solid rgba(74, 144, 226, 0.2);
		transition: all 0.3s ease;
		text-align: center;
	}

	.metric-card:hover {
		border-color: #4a90e2;
		transform: translateY(-2px);
		box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
	}

	.metric-header {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		margin-bottom: 0.7rem;
	}

	.metric-label {
		font-size: 1.1rem;
		color: #b0b0b0;
		font-weight: 500;
	}

	.metric-value {
		font-size: 2.2rem;
		font-weight: bold;
		margin-bottom: 0.3rem;
		color: #fff;
	}

	.metric-value.temperature {
		color: #ffffff;
	}

	.metric-value.humidity {
		color: #ffffff;
	}

	.metric-value.status {
		color: #4caf50;
		font-size: 1.4rem;
	}

	.metric-value.warning {
		color: #ff9800;
	}

	.metric-value.critical {
		color: #f44336;
	}

	.metric-value.offline {
		color: #757575;
	}

	.metric-value.status-indicator {
		font-size: 1.6rem;
		text-transform: capitalize;
	}

	.metric-value.status-indicator.normal {
		color: #4caf50;
	}

	.metric-value.status-indicator.warning {
		color: #ff9800;
	}

	.metric-value.status-indicator.severe {
		color: #f44336;
	}

	.metric-value.status-indicator.offline {
		color: #757575;
	}

	.metric-average,
	.status-details {
		font-size: 1rem;
		color: #888;
	}
</style>
