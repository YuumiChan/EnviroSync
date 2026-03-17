<script>
	import { config, localNow } from "$lib/config.js";
	import { rmsToMagnitude } from "$lib/magnitude.js";
	import { getTableName } from "$lib/questdbHelpers.js";
	import { magnitudeMode } from "$lib/stores.js";
	import { onDestroy, onMount } from "svelte";

	export let selectedDevice = "DHT11";

	let temperature = "29.70";
	let temperatureAvg = "25.52";
	let humidity = "87.0";
	let humidityAvg = "68.99";
	let status = "Normal";
	let loading = true;
	let metricsTimeout;

	// RMS data
	let latestRms = "0.000";

	async function fetchCurrentMetrics() {
		try {
			const deviceColName = await (await import("$lib/questdbHelpers.js")).getDeviceColumnName();
			const deviceCol = (await import("$lib/questdbHelpers.js")).getQuotedColumn(deviceColName);
			const tableName = getTableName();

			const currentQuery = `SELECT temp, humid, ts, rms FROM ${tableName} WHERE ${deviceCol}='${selectedDevice}' ORDER BY ts DESC LIMIT 1`;
			const avgQuery = `SELECT AVG(temp) as temp_avg, AVG(humid) as humid_avg FROM ${tableName} WHERE ${deviceCol}='${selectedDevice}' AND ts > dateadd('h', -24, ${localNow()})`;

			const [currentResponse, avgResponse] = await Promise.all([fetch(`/api/questdb?query=${encodeURIComponent(currentQuery)}`), fetch(`/api/questdb?query=${encodeURIComponent(avgQuery)}`)]);

			if (currentResponse.ok) {
				const currentResult = await currentResponse.json();
				if (currentResult.dataset && currentResult.dataset.length > 0) {
					const [temp, humid, timestamp, rms] = currentResult.dataset[0];
					temperature = parseFloat(temp).toFixed(2);
					humidity = parseFloat(humid).toFixed(1);
					latestRms = rms !== null ? parseFloat(rms).toFixed(3) : "0.000";

					const timestampStr = timestamp.replace("Z", "");
					const dbDate = new Date(timestampStr);
					const now = new Date();
					const minutesSinceLastUpdate = (now - dbDate) / 1000 / 60;
					const isOffline = minutesSinceLastUpdate > 30;

					if (isOffline) {
						status = "Offline";
					} else {
						status = "Normal";
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
		} catch (error) {
			console.error("Error fetching metrics:", error);
			temperature = "0.00";
			temperatureAvg = "0.00";
			humidity = "0.0";
			humidityAvg = "0.00";
			status = "ERROR";
			latestRms = "0.000";
		} finally {
			loading = false;
		}
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
	<div class="metric-card">
		{#if status === "Offline"}
			<div class="metric-value offline">Offline</div>
		{:else}
			<div class="metric-value temperature">{temperature}&deg;C</div>
			<div class="metric-average">Avg: {temperatureAvg}&deg;C</div>
		{/if}
	</div>

	<div class="metric-card">
		{#if status === "Offline"}
			<div class="metric-value offline">&mdash;</div>
		{:else}
			<div class="metric-value humidity">{humidity}%</div>
			<div class="metric-average">Avg: {humidityAvg}%</div>
		{/if}
	</div>

	<div class="metric-card">
		{#if status === "Offline"}
			<div class="metric-value offline">Offline</div>
		{:else if $magnitudeMode}
			<div class="metric-value rms">{rmsToMagnitude(parseFloat(latestRms)).toFixed(1)} Mag</div>
		{:else}
			<div class="metric-value rms">{latestRms}g</div>
		{/if}
	</div>
</div>

<style>
	.metrics-container {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		justify-content: center;
		height: 100%;
	}

	.metric-card {
		background: var(--bg-overlay);
		border-radius: 8px;
		padding: 1rem 0.75rem;
		border: 1px solid var(--border-color);
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.metric-value {
		font-size: 3.1rem;
		font-weight: bold;
		color: var(--text-primary);
	}

	.metric-value.offline {
		color: var(--text-muted);
	}

	.metric-average {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-top: 0.15rem;
	}
</style>
