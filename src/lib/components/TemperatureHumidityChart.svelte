<script>
	import { CACHE_KEYS, cacheManager } from "$lib/cache.js";
	import { Chart, registerables } from "chart.js";
	import "chartjs-adapter-date-fns";
	import annotationPlugin from "chartjs-plugin-annotation";
	import { onDestroy, onMount } from "svelte";

	export let selectedDevice = "DHT11"; // Default to DHT11 if no device selected

	Chart.register(...registerables, annotationPlugin);

	let chartCanvas;
	let chart;
	let loading = true;
	let error = null;
	let updateTimeout;
	let refreshInterval;

	// Time range is fixed to 24 hours only
	const selectedTimeRange = "day"; // always 24 hours
	let missingDataRanges = []; // track missing data periods

	// Test function to check QuestDB connectivity
	async function testConnection() {
		try {
			console.log(`Testing connection via proxy API`);

			const testQuery = "SELECT 1";
			const url = `/api/questdb?query=${encodeURIComponent(testQuery)}`;

			// Use the same minimal fetch configuration that worked in console
			const response = await fetch(url);

			if (response.ok) {
				const result = await response.json();
				console.log(`✅ Connection successful via proxy`, result);
				return true;
			}
		} catch (err) {
			console.log(`❌ Failed to connect via proxy - ${err.message}`);
		}

		return false;
	}

	// Function to get time range configuration
	function getTimeRangeConfig(range) {
		switch (range) {
			case "day":
				return {
					period: 24,
					unit: "h",
					displayUnit: "hour",
					displayFormat: "h:mm a",
					maxTicks: 12,
					expectedInterval: 1000 * 60 * 1, // expect data every 1 minute
				};
			case "week":
				return {
					period: 7,
					unit: "d",
					displayUnit: "day",
					displayFormat: "MMM dd",
					maxTicks: 7,
					expectedInterval: 1000 * 60 * 60, // expect data every hour
				};
			case "month":
				return {
					period: 30,
					unit: "d",
					displayUnit: "day",
					displayFormat: "MMM dd",
					maxTicks: 15,
					expectedInterval: 1000 * 60 * 60 * 2, // expect data every 2 hours
				};
			default:
				return getTimeRangeConfig("day");
		}
	}

	// Function to detect missing data ranges
	function detectMissingData(data, expectedInterval) {
		const missing = [];
		if (data.length < 2) return missing;

		for (let i = 1; i < data.length; i++) {
			const timeDiff = data[i].timestamp.getTime() - data[i - 1].timestamp.getTime();
			if (timeDiff > expectedInterval * 3) {
				// allow 3x tolerance
				missing.push({
					start: data[i - 1].timestamp,
					end: data[i].timestamp,
					duration: timeDiff,
				});
			}
		}
		return missing;
	}

	// Function to create missing data regions for Chart.js
	function createMissingDataRegions(missingRanges) {
		return missingRanges.map((gap) => ({
			type: "box",
			xMin: gap.start,
			xMax: gap.end,
			backgroundColor: "rgba(255, 107, 71, 0.15)",
			borderColor: "rgba(255, 107, 71, 0.3)",
			borderWidth: 1,
			label: {
				content: "Missing Data",
				enabled: true,
				position: "center",
				color: "#ff6b47",
				font: {
					size: 10,
					weight: "bold",
				},
			},
		}));
	}

	// Function to fetch data from QuestDB
	async function fetchEnvironmentalData() {
		try {
			console.log(`Attempting to fetch data for device: ${selectedDevice}, range: ${selectedTimeRange}`);

			// Try cache first
			const cacheKey = CACHE_KEYS.CHART_DATA(selectedDevice, selectedTimeRange);
			const cachedData = cacheManager.get(cacheKey);

			if (cachedData) {
				console.log("Using cached chart data");
				missingDataRanges = cachedData.missingRanges || [];
				return cachedData.data;
			}

			const timeConfig = getTimeRangeConfig(selectedTimeRange);
			// QuestDB HTTP API query to get data for the last 24 hours with 1-minute intervals
			// Using SAMPLE BY to aggregate data into 1-minute buckets for better performance
			const query = `SELECT ts, AVG(temperature) as temperature, AVG(humidity) as humidity 
						   FROM hawak 
						   WHERE device_id='${selectedDevice}' 
						   AND ts > dateadd('h', -24, now()) 
						   SAMPLE BY 1m 
						   ALIGN TO CALENDAR ORDER BY ts ASC`;

			const url = `/api/questdb?query=${encodeURIComponent(query)}`;
			console.log("Proxy URL:", url);

			// Use simple fetch like the working console test
			const response = await fetch(url);

			console.log("Response status:", response.status);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const result = await response.json();
			console.log("QuestDB response via proxy:", result);

			if (result.dataset && result.dataset.length > 0) {
				const data = result.dataset.map((row) => ({
					// Use timestamp as-is from database
					timestamp: new Date(row[0]),
					temperature: parseFloat(row[1]) || 0,
					humidity: parseFloat(row[2]) || 0,
				}));

				// Detect missing data ranges
				missingDataRanges = detectMissingData(data, timeConfig.expectedInterval);
				console.log("Missing data ranges:", missingDataRanges);

				// Cache the data for 1 minute to align with refresh intervals
				const cacheData = {
					data,
					missingRanges: missingDataRanges,
				};
				cacheManager.set(cacheKey, cacheData, 1 * 60 * 1000);

				return data;
			}

			return [];
		} catch (err) {
			console.error("Error fetching data from QuestDB via proxy:", err);
			console.error("Error details:", err.message);
			error = err.message;

			// Try to return cached data even if expired as fallback
			const cacheKey = CACHE_KEYS.CHART_DATA(selectedDevice, selectedTimeRange);
			const expiredCache = localStorage.getItem("envirosync_" + cacheKey);
			if (expiredCache) {
				try {
					const parsed = JSON.parse(expiredCache);
					console.log("Using expired cache as fallback");
					missingDataRanges = parsed.data.missingRanges || [];
					return parsed.data.data || [];
				} catch (e) {
					console.warn("Failed to parse expired cache");
				}
			}

			// Return sample data as last resort
			return generateSampleData();
		}
	}

	// Fallback sample data
	function generateSampleData() {
		const now = new Date();
		const data = [];
		const timeConfig = getTimeRangeConfig(selectedTimeRange);

		const tempValues = [8, 12, 18, 25, 30, 35, 38, 40, 45, 48, 52, 55, 50, 45, 42, 38, 35, 32, 28, 25, 22, 20, 18, 15, 12];
		const humidityValues = [15, 20, 22, 25, 30, 40, 50, 55, 60, 65, 68, 70, 65, 60, 55, 50, 45, 40, 35, 30, 28, 25, 22, 20, 18];

		let intervals, intervalMs;
		if (timeConfig.unit === "h") {
			intervals = timeConfig.period;
			intervalMs = 60 * 60 * 1000; // 1 hour
		} else {
			intervals = timeConfig.period;
			intervalMs = 24 * 60 * 60 * 1000; // 1 day
		}

		for (let i = intervals; i >= 0; i--) {
			const time = new Date(now.getTime() - i * intervalMs);
			data.push({
				timestamp: time,
				temperature: tempValues[Math.floor(Math.random() * tempValues.length)] || 25,
				humidity: humidityValues[Math.floor(Math.random() * humidityValues.length)] || 50,
			});
		}

		return data;
	}

	// Reactive function to update chart when device or time range changes
	async function updateChart() {
		if (!chart) return;

		loading = true;
		const environmentalData = await fetchEnvironmentalData();
		loading = false;

		const timestamps = environmentalData.map((d) => d.timestamp);
		const temperatures = environmentalData.map((d) => d.temperature);
		const humidities = environmentalData.map((d) => d.humidity);

		const timeConfig = getTimeRangeConfig(selectedTimeRange);

		// Update chart data
		chart.data.labels = timestamps;
		chart.data.datasets[0].data = temperatures;
		chart.data.datasets[1].data = humidities;

		// Update chart time scale configuration
		chart.options.scales.x.time.unit = timeConfig.displayUnit;
		chart.options.scales.x.time.displayFormats[timeConfig.displayUnit] = timeConfig.displayFormat;
		chart.options.scales.x.ticks.maxTicksLimit = timeConfig.maxTicks;

		// Update missing data annotations
		const missingRegions = createMissingDataRegions(missingDataRanges);
		chart.options.plugins.annotation.annotations = missingRegions;

		chart.update();
	}

	// Function removed - time range is now fixed to 24 hours only

	let previousDevice = null;

	// Reactive statement - update chart when selectedDevice changes
	$: if (selectedDevice && chart && selectedDevice !== previousDevice) {
		console.log(`Chart: Device changed from ${previousDevice} to ${selectedDevice}`);

		// Clear previous timeout and interval
		if (updateTimeout) {
			clearTimeout(updateTimeout);
		}
		if (refreshInterval) {
			clearInterval(refreshInterval);
		}

		// Update tracking variables
		previousDevice = selectedDevice;

		// Debounce the update to prevent rapid requests
		updateTimeout = setTimeout(() => {
			updateChart();

			// Set up automatic refresh for this device every 1 minute for charts
			if (refreshInterval) {
				clearInterval(refreshInterval);
			}
			refreshInterval = setInterval(() => {
				updateChart();
			}, 60000);
		}, 300);
	}

	onMount(async () => {
		const ctx = chartCanvas.getContext("2d");

		// Test connection first to find working URL
		const connectionWorking = await testConnection();

		if (connectionWorking) {
			console.log(`🎉 Proxy API is working`);
		} else {
			console.log("⚠️ No working connection found, using fallback data");
		}

		// Fetch data from QuestDB
		const environmentalData = await fetchEnvironmentalData();
		loading = false;

		const timestamps = environmentalData.map((d) => d.timestamp);
		const temperatures = environmentalData.map((d) => d.temperature);
		const humidities = environmentalData.map((d) => d.humidity);

		const timeConfig = getTimeRangeConfig(selectedTimeRange);
		const missingRegions = createMissingDataRegions(missingDataRanges);

		chart = new Chart(ctx, {
			type: "line",
			data: {
				labels: timestamps,
				datasets: [
					{
						label: "Temperature",
						data: temperatures,
						borderColor: "#FF6B47",
						backgroundColor: "rgba(255, 107, 71, 0.1)",
						borderWidth: 2,
						pointRadius: 0,
						pointHoverRadius: 4,
						tension: 0.6,
						fill: false,
					},
					{
						label: "Humidity",
						data: humidities,
						borderColor: "#4A90E2",
						backgroundColor: "rgba(74, 144, 226, 0.1)",
						borderWidth: 2,
						pointRadius: 0,
						pointHoverRadius: 4,
						tension: 0.6,
						fill: false,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: {
					intersect: false,
					mode: "index",
				},
				plugins: {
					legend: {
						display: true,
						position: "top",
						align: "end",
						labels: {
							usePointStyle: true,
							pointStyle: "circle",
							color: "#b3b3b3",
							font: {
								size: 12,
							},
							boxWidth: 6,
							boxHeight: 6,
						},
					},
					annotation: {
						annotations: missingRegions,
					},
				},
				scales: {
					x: {
						type: "time",
						time: {
							unit: timeConfig.displayUnit,
							displayFormats: {
								hour: "h:mm a",
								day: "MMM dd",
							},
						},
						grid: {
							color: "rgba(68, 68, 68, 0.5)",
							lineWidth: 1,
						},
						ticks: {
							color: "#888888",
							maxTicksLimit: timeConfig.maxTicks,
							font: {
								size: 11,
							},
						},
					},
					y: {
						beginAtZero: true,
						max: 105,
						grid: {
							color: "rgba(68, 68, 68, 0.3)",
							lineWidth: 1,
						},
						ticks: {
							color: "#888888",
							stepSize: 10,
							font: {
								size: 11,
							},
						},
					},
				},
			},
		});

		// Set up automatic refresh every 1 minute for charts
		refreshInterval = setInterval(() => {
			if (selectedDevice) {
				updateChart();
			}
		}, 60000);
	});

	onDestroy(() => {
		if (updateTimeout) {
			clearTimeout(updateTimeout);
		}
		if (refreshInterval) {
			clearInterval(refreshInterval);
		}
		if (chart) {
			chart.destroy();
		}
	});

	export { chart };

	// Manual refresh function
	async function manualRefresh() {
		if (chart && selectedDevice) {
			console.log(`Manual refresh for ${selectedDevice}...`);
			await updateChart();
		}
	}
</script>

<div class="chart-container">
	<div class="chart-header">
		<div class="chart-title">
			<span class="chart-indicator"></span>
			Humidity & Temperature Graph
			{#if loading}
				<span class="loading-indicator">Loading...</span>
			{/if}
			{#if error}
				<span class="error-indicator">Using fallback data</span>
			{/if}
			{#if missingDataRanges.length > 0}
				<span class="missing-indicator">
					⚠️ {missingDataRanges.length} gap{missingDataRanges.length > 1 ? "s" : ""}
				</span>
			{/if}
		</div>

		<div class="chart-controls">
			<button class="refresh-button" on:click={manualRefresh} disabled={loading}> 🔄 Refresh </button>
		</div>
	</div>

	<div class="chart-wrapper">
		<canvas bind:this={chartCanvas}></canvas>
	</div>
</div>

<style>
	.chart-container {
		background: rgba(0, 0, 0, 0.3);
		border-radius: 12px;
		padding: 1.5rem;
		border: 1px solid rgba(74, 144, 226, 0.2);
		margin-bottom: 2rem;
		width: 100%;
	}

	.chart-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.chart-title {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #fff;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.chart-controls {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.time-range-buttons {
		display: flex;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		padding: 2px;
		gap: 2px;
	}

	.time-range-btn {
		background: transparent;
		color: #888;
		border: none;
		padding: 6px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		font-weight: 500;
		transition: all 0.2s ease;
		white-space: nowrap;
	}

	.time-range-btn:hover {
		color: #fff;
		background: rgba(74, 144, 226, 0.2);
	}

	.time-range-btn.active {
		background: #4a90e2;
		color: white;
	}

	.chart-wrapper {
		position: relative;
		height: 400px;
		margin-top: 1rem;
	}

	.chart-indicator {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: linear-gradient(45deg, #ff6b47, #4a90e2);
	}

	.refresh-button {
		background: #4a90e2;
		color: white;
		border: none;
		padding: 6px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		font-weight: 500;
		transition: background 0.2s;
		white-space: nowrap;
	}

	.refresh-button:hover:not(:disabled) {
		background: #357abd;
	}

	.refresh-button:disabled {
		background: #666;
		cursor: not-allowed;
	}

	.loading-indicator {
		font-size: 12px;
		color: #4a90e2;
		margin-left: 8px;
	}

	.error-indicator {
		font-size: 12px;
		color: #ff6b47;
		margin-left: 8px;
	}

	.missing-indicator {
		font-size: 12px;
		color: #ffc107;
		margin-left: 8px;
		background: rgba(255, 193, 7, 0.1);
		padding: 2px 6px;
		border-radius: 3px;
		border: 1px solid rgba(255, 193, 7, 0.3);
	}

	@media (max-width: 768px) {
		.chart-header {
			flex-direction: column;
			align-items: stretch;
		}

		.chart-controls {
			justify-content: space-between;
		}

		.time-range-buttons {
			flex: 1;
			justify-content: center;
		}

		.time-range-btn {
			flex: 1;
			text-align: center;
		}
	}
</style>
