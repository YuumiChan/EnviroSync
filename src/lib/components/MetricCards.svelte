<script>
	import { config, localNow } from "$lib/config.js";
	import { rmsToMagnitude } from "$lib/magnitude.js";
	import { getTableName } from "$lib/questdbHelpers.js";
	import { magnitudeMode } from "$lib/stores.js";
	import { createEventDispatcher, onDestroy, onMount } from "svelte";

	export let selectedDevice = "DHT11";

	const dispatch = createEventDispatcher();

	let temperature = "29.70";
	let temperatureAvg = "25.52";
	let humidity = "87.0";
	let humidityAvg = "68.99";
	let status = "Normal";
	let lastUpdate = "3:00 PM";
	let loading = true;
	let metricsTimeout;

	// RMS data
	let latestRms = "0.000";
	let peakRmsTime = "";
	let rmsStatus = "Normal"; // Normal, Weak, Strong

	// RMS mode toggle
	let rmsMode = false;

	async function fetchCurrentMetrics() {
		try {
			const deviceColName = await (await import("$lib/questdbHelpers.js")).getDeviceColumnName();
			const deviceCol = (await import("$lib/questdbHelpers.js")).getQuotedColumn(deviceColName);
			const tableName = getTableName();

			const currentQuery = `SELECT temp, humid, ts, rms, quake_flag FROM ${tableName} WHERE ${deviceCol}='${selectedDevice}' ORDER BY ts DESC LIMIT 1`;
			const avgQuery = `SELECT AVG(temp) as temp_avg, AVG(humid) as humid_avg FROM ${tableName} WHERE ${deviceCol}='${selectedDevice}' AND ts > dateadd('h', -24, ${localNow()})`;
			const peakRmsQuery = `SELECT MAX(rms) as peak_rms, MAX(ts) as peak_ts FROM ${tableName} WHERE ${deviceCol}='${selectedDevice}' AND quake_flag = 2`;

			const [currentResponse, avgResponse, peakResponse] = await Promise.all([fetch(`/api/questdb?query=${encodeURIComponent(currentQuery)}`), fetch(`/api/questdb?query=${encodeURIComponent(avgQuery)}`), fetch(`/api/questdb?query=${encodeURIComponent(peakRmsQuery)}`)]);

			if (currentResponse.ok) {
				const currentResult = await currentResponse.json();
				if (currentResult.dataset && currentResult.dataset.length > 0) {
					const [temp, humid, timestamp, rms, quakeFlag] = currentResult.dataset[0];
					temperature = parseFloat(temp).toFixed(2);
					humidity = parseFloat(humid).toFixed(1);
					latestRms = rms !== null ? parseFloat(rms).toFixed(3) : "0.000";

					const timestampStr = timestamp.replace("Z", "");
					const dbDate = new Date(timestampStr);
					const now = new Date();
					const minutesSinceLastUpdate = (now - dbDate) / 1000 / 60;
					const isOffline = minutesSinceLastUpdate > 5;

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
						status = determineStatus(temperature, humidity);
					}
				}
			}

			if (avgResponse.ok) {
				const avgResult = await avgResponse.json();
				if (avgResult.dataset && avgResult.dataset.length > 0) {
					const [tempAvg, humidAvg] = avgResult.dataset[0];
					temperatureAvg = parseFloat(tempAvg).toFixed(2);
					humidityAvg = parseFloat(humidAvg).toFixed(2);
				}
			}

			if (peakResponse.ok) {
				const peakResult = await peakResponse.json();
				if (peakResult.dataset && peakResult.dataset.length > 0) {
					const [peakRms, peakTs] = peakResult.dataset[0];
					if (peakRms !== null && peakTs !== null) {
						const peakDate = new Date(String(peakTs).replace("Z", ""));
						peakRmsTime = peakDate.toLocaleString("en-US", {
							month: "short",
							day: "numeric",
							hour: "numeric",
							minute: "2-digit",
							hour12: true,
						});
					} else {
						peakRmsTime = "No events";
					}
				}
			}

			// Determine RMS status
			const savedSettings = localStorage.getItem("enviroSyncSettings");
			const settings = savedSettings ? JSON.parse(savedSettings) : { weakEarthquakeThreshold: 0.01, strongEarthquakeThreshold: 0.1 };

			const rmsVal = parseFloat(latestRms);
			if (rmsVal >= settings.strongEarthquakeThreshold) {
				rmsStatus = "Strong";
			} else if (rmsVal >= settings.weakEarthquakeThreshold) {
				rmsStatus = "Weak";
			} else {
				rmsStatus = "Normal";
			}
		} catch (error) {
			console.error("Error fetching metrics:", error);
			temperature = "0.00";
			temperatureAvg = "0.00";
			humidity = "0.0";
			humidityAvg = "0.00";
			status = "ERROR";
			lastUpdate = "N/A";
			latestRms = "0.000";
			rmsStatus = "Normal";
		} finally {
			loading = false;
		}
	}

	function determineStatus(temp, humid) {
		const t = parseFloat(temp);
		const h = parseFloat(humid);

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
				};

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

	function toggleRmsMode() {
		rmsMode = !rmsMode;
		dispatch("rmsModeChange", { rmsMode });
	}

	$: if (selectedDevice) {
		if (metricsTimeout) clearTimeout(metricsTimeout);
		metricsTimeout = setTimeout(() => {
			fetchCurrentMetrics();
		}, 350);
	}

	onMount(() => {
		fetchCurrentMetrics();
		const interval = setInterval(fetchCurrentMetrics, config.refreshIntervals.metricCards);
		return () => clearInterval(interval);
	});

	onDestroy(() => {
		if (metricsTimeout) clearTimeout(metricsTimeout);
	});
</script>

<div class="metrics-container">
	{#if !rmsMode}
		<!-- Normal mode: Temperature, Humidity, Status -->
		<div class="metric-card">
			<div class="metric-header">
				<span class="metric-label">Temperature</span>
			</div>
			{#if status === "Offline"}
				<div class="metric-value offline">Offline</div>
			{:else}
				<div class="metric-value temperature">{temperature}&deg;C</div>
				<div class="metric-average">Avg: {temperatureAvg}&deg;C</div>
			{/if}
		</div>

		<div class="metric-card">
			<div class="metric-header">
				<span class="metric-label">Humidity</span>
			</div>
			{#if status === "Offline"}
				<div class="metric-value offline">&mdash;</div>
			{:else}
				<div class="metric-value humidity">{humidity}%</div>
				<div class="metric-average">Avg: {humidityAvg}%</div>
			{/if}
		</div>

		<button class="metric-card clickable" on:click={toggleRmsMode}>
			<div class="metric-header">
				<span class="metric-label">Status</span>
			</div>
			<div class="metric-value status-indicator {status.toLowerCase()}">{status}</div>
			{#if status !== "Offline"}
				<div class="metric-average">Last Update: {lastUpdate}</div>
			{/if}
			<div class="metric-hint">Click for Magnitude view</div>
		</button>
	{:else}
		<!-- Magnitude mode: Latest magnitude value and status (clickable to revert) -->
		<div class="metric-card">
			<div class="metric-header">
				<span class="metric-label">{$magnitudeMode ? 'Magnitude' : 'RMS'}</span>
			</div>
			{#if status === "Offline"}
				<div class="metric-value offline">Offline</div>
			{:else}
				{#if $magnitudeMode}
					<div class="metric-value rms">{rmsToMagnitude(parseFloat(latestRms)).toFixed(1)} Mag</div>
				{:else}
					<div class="metric-value rms">{latestRms}g</div>
				{/if}
			{/if}
		</div>

		<button class="metric-card clickable" on:click={toggleRmsMode}>
			<div class="metric-header">
				<span class="metric-label">{$magnitudeMode ? 'Magnitude' : 'RMS'} Status</span>
			</div>
			<div class="metric-value status-indicator {rmsStatus.toLowerCase()}">{rmsStatus}</div>
			<div class="metric-hint">Click to go back</div>
		</button>
	{/if}
</div>

<style>
	.metrics-container {
		display: contents;
	}

	.metric-card {
		background: var(--bg-overlay);
		border-radius: 8px;
		padding: 1rem;
		border: 1px solid var(--border-color);
		transition: all 0.3s ease;
		text-align: center;
	}

	.metric-card:hover {
		border-color: var(--accent-blue);
		transform: translateY(-2px);
		box-shadow: var(--shadow);
	}

	.metric-card.clickable {
		cursor: pointer;
		font-family: inherit;
		font-size: inherit;
		color: inherit;
		width: 100%;
	}

	.metric-card.clickable:hover {
		border-color: var(--accent-blue);
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
		color: var(--text-secondary);
		font-weight: 500;
	}

	.metric-value {
		font-size: 2.2rem;
		font-weight: bold;
		margin-bottom: 0.3rem;
		color: var(--text-primary);
	}

	.metric-value.temperature {
		color: var(--text-primary);
	}

	.metric-value.humidity {
		color: var(--text-primary);
	}

	.metric-value.rms {
		color: var(--text-primary);
	}

	.metric-value.peak-time {
		color: var(--text-secondary);
		font-size: 1.1rem;
	}

	.metric-value.offline {
		color: var(--text-muted);
	}

	.metric-value.status-indicator {
		font-size: 1.6rem;
		text-transform: capitalize;
	}

	.metric-value.status-indicator.normal {
		color: var(--text-primary);
	}

	.metric-value.status-indicator.warning {
		color: var(--text-primary);
	}

	.metric-value.status-indicator.severe {
		color: var(--text-primary);
	}

	.metric-value.status-indicator.offline {
		color: var(--text-muted);
	}

	.metric-value.status-indicator.weak {
		color: var(--text-primary);
	}

	.metric-value.status-indicator.strong {
		color: var(--text-primary);
	}

	.metric-average,
	.status-details {
		font-size: 1rem;
		color: var(--text-muted);
	}

	.metric-hint {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-top: 0.4rem;
		opacity: 0.6;
	}
</style>
