<script>
	import { localNow } from "$lib/config.js";
	import { getTableName } from "$lib/questdbHelpers.js";
	import { Chart, registerables } from "chart.js";
	import "chartjs-adapter-date-fns";
	import { onDestroy, onMount } from "svelte";

	export let selectedDevice = "DHT11"; // Default to DHT11 if no device selected

	Chart.register(...registerables);

	let chartCanvas;
	let chart;
	let loading = true;
	let error = null;
	let updateTimeout;
	let refreshInterval;

	// Time range configuration
	let selectedTimeRange = "day"; // Default to day view

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
					samplePoints: 31,
					expectedInterval: 1000 * 60 * 1, // expect data every 1 minute
				};
			case "week":
				return {
					period: 168,
					unit: "h",
					displayUnit: "day",
					displayFormat: "MMM dd",
					maxTicks: 7,
					samplePoints: 31,
					expectedInterval: 1000 * 60 * 60, // expect data every hour
				};
			case "month":
				return {
					period: 720,
					unit: "h",
					displayUnit: "day",
					displayFormat: "MMM dd",
					maxTicks: 15,
					samplePoints: 31,
					expectedInterval: 1000 * 60 * 60 * 2, // expect data every 2 hours
				};
			default:
				return getTimeRangeConfig("day");
		}
	}

	// Function to fetch data from QuestDB
	async function fetchEnvironmentalData() {
		try {
			console.log(`Attempting to fetch data for device: ${selectedDevice}, range: ${selectedTimeRange}`);

			const timeConfig = getTimeRangeConfig(selectedTimeRange);
			const deviceColName = await (await import("$lib/questdbHelpers.js")).getDeviceColumnName();
			const deviceCol = (await import("$lib/questdbHelpers.js")).getQuotedColumn(deviceColName);
			const tableName = getTableName();

			const totalHours = timeConfig.period;

			// Calculate sample interval to ensure 31 time buckets across the entire range
			// This ensures FILL(linear) generates 31 points even with sparse data
			const targetPoints = 31;
			const sampleMinutes = Math.floor((totalHours * 60) / targetPoints);

			// Use SAMPLE BY with FILL(linear) - always generates 31 points even with sparse data
			const query = `SELECT ts, avg(temp) AS temp, avg(humid) AS humid FROM ${tableName} WHERE ${deviceCol}='${selectedDevice}' AND ts > dateadd('h', -${totalHours}, ${localNow()}) SAMPLE BY ${sampleMinutes}m FILL(linear)`;

			const url = `/api/questdb?query=${encodeURIComponent(query)}`;
			console.log("Fetching fresh data with SAMPLE BY:", query);

			const response = await fetch(url);

			console.log("Response status:", response.status);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const result = await response.json();
			console.log("QuestDB SAMPLE BY response:", result);

			if (result.dataset && result.dataset.length > 0) {
				const data = result.dataset.map((row) => {
					// Treat timestamp as already in local time (UTC+8) - remove Z to avoid conversion
					const timestampStr = row[0].replace("Z", "");
					return {
						timestamp: new Date(timestampStr),
						temperature: parseFloat(row[1]),
						humidity: parseFloat(row[2]),
					};
				});

				console.log(`Fetched ${data.length} aggregated points via SAMPLE BY`);
				return data;
			} else {
				console.log("No data returned from QuestDB");
				return [];
			}
		} catch (err) {
			console.error("Error fetching data from QuestDB via proxy:", err);
			console.error("Error details:", err.message);
			error = err.message;
			return [];
		}
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

		chart.update();
	}

	// Function to change time range
	function changeTimeRange(newRange) {
		selectedTimeRange = newRange;
		updateChart();
	}

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
		<h2>Temperature & Humidity</h2>
		<div class="time-range-buttons">
			<button class="time-range-btn" class:active={selectedTimeRange === "day"} on:click={() => changeTimeRange("day")}> Last 24 Hours </button>
			<button class="time-range-btn" class:active={selectedTimeRange === "week"} on:click={() => changeTimeRange("week")}> Last Week </button>
			<button class="time-range-btn" class:active={selectedTimeRange === "month"} on:click={() => changeTimeRange("month")}> Last Month </button>
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
		align-items: center;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
		gap: 1rem;
	}

	h2 {
		font-size: 1.5rem;
		color: #ffffff;
		margin: 0;
	}

	.time-range-buttons {
		display: flex;
		gap: 0.5rem;
	}

	.time-range-btn {
		padding: 0.5rem 1rem;
		border: 1px solid rgba(74, 144, 226, 0.3);
		background: rgba(0, 0, 0, 0.3);
		color: #4a90e2;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 0.9rem;
	}

	.time-range-btn:hover {
		border-color: #4a90e2;
		background: rgba(74, 144, 226, 0.1);
	}

	.time-range-btn.active {
		background: #4a90e2;
		color: #ffffff;
		border-color: #4a90e2;
	}

	.chart-wrapper {
		position: relative;
		height: 400px;
		width: 100%;
	}

	.chart-wrapper canvas {
		width: 100% !important;
		height: 100% !important;
	}

	@media (max-width: 768px) {
		.chart-container {
			padding: 1rem;
		}

		.chart-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.chart-wrapper {
			height: 300px;
		}

		.time-range-buttons {
			width: 100%;
			justify-content: space-between;
		}

		.time-range-btn {
			flex: 1;
			padding: 0.5rem;
			font-size: 0.8rem;
		}
	}
</style>
