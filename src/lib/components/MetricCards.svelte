<script>
	import { CACHE_KEYS, cacheManager } from "$lib/cache.js";
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

			// Try cache first
			const cacheKey = CACHE_KEYS.METRICS(selectedDevice);
			const cachedMetrics = cacheManager.get(cacheKey);

			if (cachedMetrics) {
				console.log("Using cached metrics");
				temperature = cachedMetrics.temperature;
				temperatureAvg = cachedMetrics.temperatureAvg;
				humidity = cachedMetrics.humidity;
				humidityAvg = cachedMetrics.humidityAvg;
				status = cachedMetrics.status;
				lastUpdate = cachedMetrics.lastUpdate;
				loading = false;
				return;
			}

			// Get current readings (latest record)
			const currentQuery = `SELECT temperature, humidity, ts FROM hawak WHERE device_id='${selectedDevice}' ORDER BY ts DESC LIMIT 1`;

			// Get averages for last 24 hours
			const avgQuery = `SELECT AVG(temperature) as temp_avg, AVG(humidity) as humid_avg FROM hawak WHERE device_id='${selectedDevice}' AND ts > dateadd('h', -24, now())`;

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

					// Use timestamp as-is from database
					const dbDate = new Date(timestamp);
					lastUpdate = dbDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

			// Determine status based on readings
			status = determineStatus(temperature, humidity);

			// Cache the metrics for 2 minutes
			const metricsData = {
				temperature,
				temperatureAvg,
				humidity,
				humidityAvg,
				status,
				lastUpdate,
			};
			cacheManager.set(cacheKey, metricsData, 2 * 60 * 1000);
		} catch (error) {
			console.error("Error fetching metrics:", error);
			console.error("Error details:", error.message);
			console.error("Error name:", error.name);

			// Try to use expired cache as fallback
			const cacheKey = CACHE_KEYS.METRICS(selectedDevice);
			const expiredCache = localStorage.getItem("envirosync_" + cacheKey);
			if (expiredCache) {
				try {
					const parsed = JSON.parse(expiredCache);
					const metrics = parsed.data;
					console.log("Using expired cache as fallback");
					temperature = metrics.temperature;
					temperatureAvg = metrics.temperatureAvg;
					humidity = metrics.humidity;
					humidityAvg = metrics.humidityAvg;
					status = metrics.status;
					lastUpdate = metrics.lastUpdate;
				} catch (e) {
					console.warn("Failed to parse expired cache, using defaults");
				}
			}
		} finally {
			loading = false;
		}
	}

	// Function to determine system status
	function determineStatus(temp, humid) {
		const t = parseFloat(temp);
		const h = parseFloat(humid);

		// Define normal ranges
		const tempNormal = t >= 18 && t <= 35;
		const humidNormal = h >= 30 && h <= 80;

		if (tempNormal && humidNormal) {
			return "NORMAL";
		} else if (t > 40 || h > 90) {
			return "CRITICAL";
		} else {
			return "WARNING";
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

		// Set up automatic refresh every 10 seconds
		const interval = setInterval(fetchCurrentMetrics, 10000);
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
			<svg class="metric-icon" viewBox="0 0 24 24" fill="#FF6B47">
				<path d="M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4zm-4-2V5c0-.55.45-1 1-1s1 .45 1 1v6h-2z" />
			</svg>
			<span class="metric-label">Temperature</span>
		</div>
		<div class="metric-value temperature">{temperature}°C</div>
		<div class="metric-average">Avg: {temperatureAvg}°C</div>
	</div>

	<!-- Humidity Card -->
	<div class="metric-card">
		<div class="metric-header">
			<svg class="metric-icon" viewBox="0 0 24 24" fill="#4A90E2">
				<path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8zM12 20c-3.35 0-6-2.57-6-5.2 0-2.34 1.95-5.44 6-9.14 4.05 3.7 6 6.79 6 9.14 0 2.63-2.65 5.2-6 5.2z" />
			</svg>
			<span class="metric-label">Humidity</span>
		</div>
		<div class="metric-value humidity">{humidity}%</div>
		<div class="metric-average">Avg: {humidityAvg}%</div>
	</div>

	<!-- Status Card -->
	<div class="metric-card">
		<div class="metric-header">
			<svg class="metric-icon" viewBox="0 0 24 24" fill={status === "NORMAL" ? "#4CAF50" : status === "WARNING" ? "#FF9800" : "#F44336"}>
				{#if status === "NORMAL"}
					<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
				{:else if status === "WARNING"}
					<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
				{:else}
					<path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
				{/if}
			</svg>
			<span class="metric-label">Status</span>
		</div>
		<div class="metric-value status" class:warning={status === "WARNING"} class:critical={status === "CRITICAL"}>
			{loading ? "LOADING..." : status}
		</div>
		<div class="status-details">as of {lastUpdate}</div>
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
	}

	.metric-card:hover {
		border-color: #4a90e2;
		transform: translateY(-2px);
		box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
	}

	.metric-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.7rem;
	}

	.metric-icon {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
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
		color: #ff6b47;
	}

	.metric-value.humidity {
		color: #4a90e2;
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

	.metric-average,
	.status-details {
		font-size: 1rem;
		color: #888;
	}
</style>
