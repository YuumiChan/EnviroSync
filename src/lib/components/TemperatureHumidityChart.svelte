<script>
	import { localNow } from "$lib/config.js";
	import { rmsToMagnitude } from "$lib/magnitude.js";
	import { getTableName } from "$lib/questdbHelpers.js";
	import { magnitudeMode } from "$lib/stores.js";
	import { Chart, registerables } from "chart.js";
	import "chartjs-adapter-date-fns";
	import { createEventDispatcher, onDestroy, onMount } from "svelte";

	export let selectedDevice = "DHT11";
	export let onBackToDevices = null;
	export let rmsMode = false;

	const dispatch = createEventDispatcher();

	Chart.register(...registerables);

	let chartCanvas;
	let chart;
	let loading = true;
	let error = null;
	let updateTimeout;
	let refreshInterval;

	let selectedTimeRange = "day";

	async function testConnection() {
		try {
			const testQuery = "SELECT 1";
			const url = `/api/questdb?query=${encodeURIComponent(testQuery)}`;
			const response = await fetch(url);
			if (response.ok) {
				return true;
			}
		} catch (err) {
			// silent
		}
		return false;
	}

	function getTimeRangeConfig(range) {
		switch (range) {
			case "day":
				return {
					period: 24,
					unit: "h",
					displayUnit: "hour",
					displayFormat: "h:mm a",
					maxTicks: 12,
					samplePoints: 100,
					expectedInterval: 1000 * 60 * 1,
				};
			case "week":
				return {
					period: 168,
					unit: "h",
					displayUnit: "day",
					displayFormat: "MMM dd",
					maxTicks: 7,
					samplePoints: 100,
					expectedInterval: 1000 * 60 * 60,
				};
			case "month":
				return {
					period: 720,
					unit: "h",
					displayUnit: "day",
					displayFormat: "MMM dd",
					maxTicks: 15,
					samplePoints: 100,
					expectedInterval: 1000 * 60 * 60 * 2,
				};
			default:
				return getTimeRangeConfig("day");
		}
	}

	async function fetchEnvironmentalData() {
		try {
			const timeConfig = getTimeRangeConfig(selectedTimeRange);
			const deviceColName = await (await import("$lib/questdbHelpers.js")).getDeviceColumnName();
			const deviceCol = (await import("$lib/questdbHelpers.js")).getQuotedColumn(deviceColName);
			const tableName = getTableName();

			const totalHours = timeConfig.period;
			const targetPoints = 100;
			const sampleMinutes = Math.floor((totalHours * 60) / targetPoints);

			const query = `SELECT ts, avg(temp) AS temp, avg(humid) AS humid, avg(rms) AS rms FROM ${tableName} WHERE ${deviceCol}='${selectedDevice}' AND ts > dateadd('h', -${totalHours}, ${localNow()}) SAMPLE BY ${sampleMinutes}m FILL(linear)`;

			const url = `/api/questdb?query=${encodeURIComponent(query)}`;
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const result = await response.json();

			if (result.dataset && result.dataset.length > 0) {
				const data = result.dataset.map((row) => {
					const timestampStr = row[0].replace("Z", "");
					return {
						timestamp: new Date(timestampStr),
						temperature: parseFloat(row[1]),
						humidity: parseFloat(row[2]),
						rms: row[3] !== null ? parseFloat(row[3]) : null,
					};
				});
				return data;
			} else {
				return [];
			}
		} catch (err) {
			error = err.message;
			return [];
		}
	}

	function getChartConfig(environmentalData, timeConfig) {
		const timestamps = environmentalData.map((d) => d.timestamp);
		const useMag = $magnitudeMode;

		if (rmsMode) {
			const rmsValues = useMag
				? environmentalData.map((d) => d.rms !== null ? rmsToMagnitude(d.rms) : null)
				: environmentalData.map((d) => d.rms);
			const label = useMag ? "Magnitude" : "RMS (g)";
			return {
				labels: timestamps,
				datasets: [
					{
						label: label,
						data: rmsValues,
						borderColor: "#9b59b6",
						backgroundColor: "rgba(155, 89, 182, 0.1)",
						borderWidth: 2,
						pointRadius: 0,
						pointHoverRadius: 4,
						tension: 0.6,
						fill: false,
					},
				],
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
						grid: { color: "rgba(68, 68, 68, 0.5)", lineWidth: 1 },
						ticks: { color: "#888888", maxTicksLimit: timeConfig.maxTicks, font: { size: 11 } },
					},
					y: {
						beginAtZero: true,
						max: useMag ? undefined : 1.0,
						grid: { color: "rgba(68, 68, 68, 0.3)", lineWidth: 1 },
						ticks: {
							color: "#9b59b6",
							font: { size: 11 },
							callback: function (value) {
								return useMag ? value.toFixed(1) : value.toFixed(2) + "g";
							},
						},
					},
				},
			};
		} else {
			const temperatures = environmentalData.map((d) => d.temperature);
			const humidities = environmentalData.map((d) => d.humidity);
			return {
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
						grid: { color: "rgba(68, 68, 68, 0.5)", lineWidth: 1 },
						ticks: { color: "#888888", maxTicksLimit: timeConfig.maxTicks, font: { size: 11 } },
					},
					y: {
						beginAtZero: true,
						max: 105,
						grid: { color: "rgba(68, 68, 68, 0.3)", lineWidth: 1 },
						ticks: { color: "#888888", stepSize: 10, font: { size: 11 } },
					},
				},
			};
		}
	}

	async function updateChart() {
		if (!chart) return;

		loading = true;
		const environmentalData = await fetchEnvironmentalData();
		loading = false;

		const timeConfig = getTimeRangeConfig(selectedTimeRange);
		const config = getChartConfig(environmentalData, timeConfig);

		chart.data.labels = config.labels;
		chart.data.datasets = config.datasets;
		chart.options.scales = config.scales;
		chart.update();
	}

	function changeTimeRange(newRange) {
		selectedTimeRange = newRange;
		updateChart();
	}

	let previousDevice = null;
	let previousRmsMode = rmsMode;
	let previousMagnitudeMode = false;

	$: if (selectedDevice && chart && selectedDevice !== previousDevice) {
		if (updateTimeout) clearTimeout(updateTimeout);
		if (refreshInterval) clearInterval(refreshInterval);
		previousDevice = selectedDevice;
		updateTimeout = setTimeout(() => {
			updateChart();
			if (refreshInterval) clearInterval(refreshInterval);
			refreshInterval = setInterval(() => { updateChart(); }, 60000);
		}, 300);
	}

	$: if (chart && rmsMode !== previousRmsMode) {
		previousRmsMode = rmsMode;
		updateChart();
	}

	$: if (chart && $magnitudeMode !== previousMagnitudeMode) {
		previousMagnitudeMode = $magnitudeMode;
		if (rmsMode) updateChart();
	}

	onMount(async () => {
		const ctx = chartCanvas.getContext("2d");
		await testConnection();

		const environmentalData = await fetchEnvironmentalData();
		loading = false;

		const timeConfig = getTimeRangeConfig(selectedTimeRange);
		const chartCfg = getChartConfig(environmentalData, timeConfig);

		chart = new Chart(ctx, {
			type: "line",
			data: {
				labels: chartCfg.labels,
				datasets: chartCfg.datasets,
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: { intersect: false, mode: "index" },
				plugins: {
					legend: {
						display: true,
						position: "top",
						align: "end",
						labels: {
							usePointStyle: true,
							pointStyle: "circle",
							color: "#b3b3b3",
							font: { size: 12 },
							boxWidth: 6,
							boxHeight: 6,
						},
					},
				},
				scales: chartCfg.scales,
			},
		});

		refreshInterval = setInterval(() => {
			if (selectedDevice) updateChart();
		}, 60000);
	});

	onDestroy(() => {
		if (updateTimeout) clearTimeout(updateTimeout);
		if (refreshInterval) clearInterval(refreshInterval);
		if (chart) chart.destroy();
	});

	export { chart };
</script>

<div class="chart-container">
	<div class="chart-header">
		{#if onBackToDevices}
			<button class="back-button" on:click={onBackToDevices}>&larr; Back to Devices</button>
		{:else}
			<h2>{rmsMode ? ($magnitudeMode ? "Magnitude" : "RMS") : "Temperature & Humidity"}</h2>
		{/if}
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
		background: var(--bg-overlay);
		border-radius: 12px;
		padding: 1.5rem;
		border: 1px solid var(--border-color);
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
		color: var(--text-primary);
		margin: 0;
	}

	.back-button {
		background: none;
		border: 1px solid var(--border-color);
		color: var(--text-muted);
		padding: 0.5rem 1rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.2s ease;
		font-family: inherit;
	}

	.back-button:hover {
		border-color: var(--text-muted);
		color: var(--text-primary);
	}

	.time-range-buttons {
		display: flex;
		gap: 0.5rem;
	}

	.time-range-btn {
		padding: 0.5rem 1rem;
		border: 1px solid var(--border-color);
		background: var(--bg-overlay);
		color: var(--text-secondary);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 0.9rem;
		font-family: inherit;
	}

	.time-range-btn:hover {
		border-color: var(--text-muted);
		color: var(--text-primary);
	}

	.time-range-btn.active {
		background: var(--text-primary);
		color: var(--bg-primary);
		border-color: var(--text-primary);
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
