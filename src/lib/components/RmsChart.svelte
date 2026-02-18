<script>
	import { localNow } from "$lib/config.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { Chart, registerables } from "chart.js";
	import "chartjs-adapter-date-fns";
	import { onDestroy, onMount } from "svelte";

	Chart.register(...registerables);

	let chartCanvas;
	let chart;
	let loading = true;
	let timeRange = "24h"; // Default to 24 hours

	const timeRangeOptions = [
		{ value: "24h", label: "Last 24 Hours", hours: 24, samplePoints: 31 },
		{ value: "1w", label: "Last Week", hours: 168, samplePoints: 31 },
		{ value: "1m", label: "Last Month", hours: 720, samplePoints: 31 },
	];

	async function fetchRmsData() {
		try {
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();
			const selectedRange = timeRangeOptions.find((r) => r.value === timeRange);
			const hours = selectedRange.hours;
			const samplePoints = selectedRange.samplePoints;

			// Calculate sample interval in minutes
			const sampleInterval = Math.floor((hours * 60) / samplePoints);

			// Query with timestamp_floor to bucket data (table has no designated timestamp)
			const query = `SELECT timestamp_floor('${sampleInterval}m', ts) as bucket, AVG(rms) as avg_rms FROM ${tableName} WHERE ts > dateadd('h', -${hours}, ${localNow()}) GROUP BY bucket ORDER BY bucket`;

			const response = await fetch(`/api/questdb?query=${encodeURIComponent(query)}`);

			if (response.ok) {
				const result = await response.json();
				if (result.dataset && result.dataset.length > 0) {
					const data = result.dataset.map((row) => ({
						timestamp: new Date(row[0]),
						rms: parseFloat(row[1]),
					}));
					return data;
				}
			}
			return [];
		} catch (error) {
			console.error("Error fetching RMS data:", error);
			return [];
		}
	}

	async function updateChart() {
		if (!chart) return;

		loading = true;
		const rmsData = await fetchRmsData();
		loading = false;

		const timestamps = rmsData.map((d) => d.timestamp);
		const rmsValues = rmsData.map((d) => d.rms);

		chart.data.labels = timestamps;
		chart.data.datasets[0].data = rmsValues;
		chart.update();
	}

	function changeTimeRange(newRange) {
		timeRange = newRange;
		updateChart();
	}

	onMount(() => {
		const ctx = chartCanvas.getContext("2d");

		chart = new Chart(ctx, {
			type: "line",
			data: {
				labels: [],
				datasets: [
					{
						label: "RMS",
						data: [],
						borderColor: "#9c27b0",
						backgroundColor: "rgba(156, 39, 176, 0.1)",
						borderWidth: 2,
						fill: true,
						tension: 0.4,
						pointRadius: 3,
						pointHoverRadius: 6,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: {
						display: true,
						labels: {
							color: "#ffffff",
							font: { size: 14 },
						},
					},
					tooltip: {
						mode: "index",
						intersect: false,
						backgroundColor: "rgba(0, 0, 0, 0.8)",
						titleColor: "#ffffff",
						bodyColor: "#ffffff",
						borderColor: "#9c27b0",
						borderWidth: 1,
					},
				},
				scales: {
					x: {
						type: "time",
						time: {
							displayFormats: {
								hour: "h:mm a",
								day: "MMM dd",
							},
						},
						ticks: {
							color: "#888888",
							maxTicksLimit: 12,
						},
						grid: {
							color: "rgba(255, 255, 255, 0.1)",
						},
					},
					y: {
						beginAtZero: true,
						ticks: {
							color: "#888888",
						},
						grid: {
							color: "rgba(255, 255, 255, 0.1)",
						},
						title: {
							display: true,
							text: "RMS Value",
							color: "#888888",
						},
					},
				},
			},
		});

		updateChart();
	});

	onDestroy(() => {
		if (chart) {
			chart.destroy();
		}
	});
</script>

<div class="chart-container">
	<div class="chart-header">
		<h2>RMS Monitoring</h2>
		<div class="time-range-buttons">
			{#each timeRangeOptions as option}
				<button class="time-range-btn" class:active={timeRange === option.value} on:click={() => changeTimeRange(option.value)}>
					{option.label}
				</button>
			{/each}
		</div>
	</div>
	<div class="chart-wrapper">
		{#if loading}
			<div class="loading-overlay">Loading...</div>
		{/if}
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
		border: 1px solid rgba(156, 39, 176, 0.3);
		background: rgba(0, 0, 0, 0.3);
		color: #9c27b0;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 0.9rem;
	}

	.time-range-btn:hover {
		border-color: #9c27b0;
		background: rgba(156, 39, 176, 0.1);
	}

	.time-range-btn.active {
		background: #9c27b0;
		color: #ffffff;
		border-color: #9c27b0;
	}

	.chart-wrapper {
		position: relative;
		height: 400px;
	}

	.loading-overlay {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: #888;
		font-size: 1.2rem;
	}

	@media (max-width: 768px) {
		.chart-header {
			flex-direction: column;
			align-items: flex-start;
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
