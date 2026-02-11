<script>
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { Chart, registerables } from "chart.js";
	import "chartjs-adapter-date-fns";
	import { onDestroy, onMount } from "svelte";

	Chart.register(...registerables);

	export let onClose;

	let chartCanvas;
	let chart;
	let loading = true;

	async function fetchEarthquakeData() {
		try {
			loading = true;
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();

			// Get RMS data from all devices for last 24 hours where quake_flag = 2
			// Use UNION to combine sampled historical data with the absolute latest point
			const query = `
				SELECT ts, ${deviceCol} as device, rms 
				FROM ${tableName} 
				WHERE quake_flag = 2 AND ts > dateadd('h', -24, now()) 
				AND ts < (SELECT MAX(ts) FROM ${tableName} WHERE quake_flag = 2)
				UNION ALL
				SELECT ts, ${deviceCol} as device, rms 
				FROM ${tableName} 
				WHERE quake_flag = 2 
				AND ts = (SELECT MAX(ts) FROM ${tableName} WHERE quake_flag = 2)
				ORDER BY ts ASC
			`;

			const response = await fetch(`/api/questdb?query=${encodeURIComponent(query)}`);

			if (response.ok) {
				const result = await response.json();

				if (result.dataset && result.dataset.length > 0) {
					// Group data by device
					const deviceData = {};
					result.dataset.forEach(([timestamp, device, rms]) => {
						if (!deviceData[device]) {
							deviceData[device] = [];
						}
						deviceData[device].push({
							x: new Date(timestamp),
							y: parseFloat(rms),
						});
					});

					// Create datasets for each device
					const datasets = Object.keys(deviceData).map((device, index) => {
						const colors = ["#ff6b47", "#4a90e2", "#9c27b0", "#4caf50", "#ff9800"];
						return {
							label: device,
							data: deviceData[device],
							borderColor: colors[index % colors.length],
							backgroundColor: colors[index % colors.length] + "33",
							borderWidth: 2,
							pointRadius: 4,
							tension: 0.1,
						};
					});

					createChart(datasets);
				} else {
					createChart([]);
				}
			}
		} catch (err) {
			console.error("Error fetching earthquake data:", err);
			createChart([]);
		} finally {
			loading = false;
		}
	}

	function createChart(datasets) {
		if (chart) {
			chart.destroy();
		}

		chart = new Chart(chartCanvas, {
			type: "line",
			data: { datasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: {
						display: true,
						position: "top",
						labels: {
							color: "#fff",
							font: { size: 12 },
						},
					},
					title: {
						display: true,
						text: "RMS Magnitude During Earthquake Detection (Last 24h)",
						color: "#fff",
						font: { size: 16, weight: "bold" },
					},
				},
				scales: {
					x: {
						type: "time",
						time: {
							unit: "minute",
							displayFormats: {
								minute: "HH:mm",
								hour: "HH:mm",
							},
						},
						ticks: {
							color: "#b0b0b0",
							autoSkip: true,
							maxRotation: 45,
							minRotation: 0,
						},
						grid: {
							color: "rgba(255, 255, 255, 0.1)",
						},
					},
					y: {
						beginAtZero: true,
						title: {
							display: true,
							text: "RMS Magnitude (g)",
							color: "#fff",
						},
						ticks: {
							color: "#b0b0b0",
						},
						grid: {
							color: "rgba(255, 255, 255, 0.1)",
						},
					},
				},
			},
		});
	}

	onMount(() => {
		fetchEarthquakeData();
	});

	onDestroy(() => {
		if (chart) {
			chart.destroy();
		}
	});
</script>

<div class="earthquake-modal-overlay" on:click={onClose}>
	<div class="earthquake-modal" on:click|stopPropagation>
		<div class="modal-header">
			<h2>Earthquake Detection - RMS Comparison</h2>
			<button class="close-btn" on:click={onClose}>×</button>
		</div>

		<div class="modal-content">
			{#if loading}
				<div class="loading">
					<div class="spinner"></div>
					<p>Loading earthquake data...</p>
				</div>
			{:else}
				<div class="chart-container">
					<canvas bind:this={chartCanvas}></canvas>
				</div>

				<div class="info-section">
					<h3>Understanding RMS Magnitude (g-force)</h3>
					<div class="info-grid">
						<div class="info-card rest">
							<div class="range">0g - 0.001g</div>
							<div class="description">At Rest</div>
							<div class="detail">Normal environmental vibration</div>
						</div>
						<div class="info-card minor">
							<div class="range">0.002g - 0.020g</div>
							<div class="description">Footsteps/Vehicles</div>
							<div class="detail">Passing by or nearby movement</div>
						</div>
						<div class="info-card attention">
							<div class="range">0.021g - 0.050g</div>
							<div class="description">Pay Attention</div>
							<div class="detail">Not noticeable but worth monitoring</div>
						</div>
						<div class="info-card earthquake">
							<div class="range">&gt; 0.050g</div>
							<div class="description">Noticeable Earthquake</div>
							<div class="detail">Detectable seismic activity</div>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.earthquake-modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 2rem;
	}

	.earthquake-modal {
		background: #1a1a1a;
		border-radius: 12px;
		width: 100%;
		max-width: 1200px;
		max-height: 90vh;
		overflow-y: auto;
		color: #fff;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.5rem 2rem;
		border-bottom: 1px solid #333;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.5rem;
		color: #fff;
	}

	.close-btn {
		background: none;
		border: none;
		color: #fff;
		font-size: 2rem;
		cursor: pointer;
		padding: 0;
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		transition: background 0.2s;
	}

	.close-btn:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.modal-content {
		padding: 2rem;
	}

	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 300px;
		gap: 1rem;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 4px solid #333;
		border-top: 4px solid #9c27b0;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	.chart-container {
		height: 400px;
		margin-bottom: 2rem;
		background: rgba(0, 0, 0, 0.3);
		padding: 1rem;
		border-radius: 8px;
	}

	.info-section {
		margin-top: 2rem;
	}

	.info-section h3 {
		margin-bottom: 1rem;
		color: #b0b0b0;
		font-size: 1.2rem;
	}

	.info-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 1rem;
	}

	.info-card {
		background: rgba(0, 0, 0, 0.4);
		padding: 1.5rem;
		border-radius: 8px;
		border-left: 4px solid;
	}

	.info-card.rest {
		border-left-color: #4caf50;
	}

	.info-card.minor {
		border-left-color: #4a90e2;
	}

	.info-card.attention {
		border-left-color: #ff9800;
	}

	.info-card.earthquake {
		border-left-color: #f44336;
	}

	.info-card .range {
		font-size: 1.2rem;
		font-weight: bold;
		margin-bottom: 0.5rem;
	}

	.info-card .description {
		font-size: 1rem;
		color: #b0b0b0;
		margin-bottom: 0.3rem;
	}

	.info-card .detail {
		font-size: 0.9rem;
		color: #888;
	}

	@media (max-width: 768px) {
		.earthquake-modal-overlay {
			padding: 1rem;
		}

		.modal-content {
			padding: 1rem;
		}

		.chart-container {
			height: 300px;
		}

		.info-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
