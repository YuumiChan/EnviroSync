<script>
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

	let workingUrl = null;

	// Function to fetch data from QuestDB
	async function fetchEnvironmentalData() {
		try {
			console.log(`Attempting to fetch data for device: ${selectedDevice}`);

			// QuestDB HTTP API query to get last 24 hours of data for the selected device
			const query = `SELECT ts, temperature, humidity FROM hawak WHERE device_id='${selectedDevice}' AND ts > dateadd('h', -24, now()) ORDER BY ts ASC`;

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
				return result.dataset.map((row) => ({
					// Convert UTC timestamp to UTC+8 for display
					timestamp: new Date(new Date(row[0]).getTime() + 8 * 60 * 60 * 1000),
					temperature: parseFloat(row[1]) || 0,
					humidity: parseFloat(row[2]) || 0,
				}));
			}

			return [];
		} catch (err) {
			console.error("Error fetching data from QuestDB via proxy:", err);
			console.error("Error details:", err.message);
			error = err.message;

			// Return sample data as fallback
			return generateSampleData();
		}
	}

	// Fallback sample data
	function generateSampleData() {
		const now = new Date();
		const data = [];

		const tempValues = [8, 12, 18, 25, 30, 35, 38, 40, 45, 48, 52, 55, 50, 45, 42, 38, 35, 32, 28, 25, 22, 20, 18, 15, 12];
		const humidityValues = [15, 20, 22, 25, 30, 40, 50, 55, 60, 65, 68, 70, 65, 60, 55, 50, 45, 40, 35, 30, 28, 25, 22, 20, 18];

		for (let i = 24; i >= 0; i--) {
			const time = new Date(now.getTime() - i * 60 * 60 * 1000);
			data.push({
				timestamp: time,
				temperature: tempValues[24 - i] || 25,
				humidity: humidityValues[24 - i] || 50,
			});
		}

		return data;
	}

	// Reactive function to update chart when device changes
	async function updateChart() {
		if (!chart) return;

		loading = true;
		const environmentalData = await fetchEnvironmentalData();
		loading = false;

		const timestamps = environmentalData.map((d) => d.timestamp);
		const temperatures = environmentalData.map((d) => d.temperature);
		const humidities = environmentalData.map((d) => d.humidity);

		// Update chart data
		chart.data.labels = timestamps;
		chart.data.datasets[0].data = temperatures;
		chart.data.datasets[1].data = humidities;
		chart.update();
	}

	let previousDevice = null;

	// Reactive statement - only update chart when selectedDevice changes (no auto-refresh)
	$: if (selectedDevice && chart && selectedDevice !== previousDevice) {
		console.log(`Chart: Device changed from ${previousDevice} to ${selectedDevice}`);

		// Clear previous timeout and interval
		if (updateTimeout) {
			clearTimeout(updateTimeout);
		}
		if (refreshInterval) {
			clearInterval(refreshInterval);
		}

		// Update tracking variable
		previousDevice = selectedDevice;

		// Debounce the update to prevent rapid requests
		updateTimeout = setTimeout(() => {
			updateChart();
			// No automatic refresh - only manual refresh button
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
							unit: "hour",
							displayFormats: {
								hour: "h:mm a",
							},
						},
						grid: {
							color: "rgba(68, 68, 68, 0.5)",
							lineWidth: 1,
						},
						ticks: {
							color: "#888888",
							maxTicksLimit: 12,
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
	<div class="chart-title">
		<span class="chart-indicator"></span>
		Humidity & Temperature Graph
		<button class="refresh-button" on:click={manualRefresh} disabled={loading}> 🔄 Refresh </button>
		{#if loading}
			<span class="loading-indicator">Loading...</span>
		{/if}
		{#if error}
			<span class="error-indicator">Using fallback data</span>
		{/if}
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

	.chart-wrapper {
		position: relative;
		height: 400px;
		margin-top: 1rem;
	}

	.chart-title {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #fff;
		font-size: 1.1rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
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
		padding: 4px 8px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 11px;
		margin-left: auto;
		transition: background 0.2s;
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
</style>
