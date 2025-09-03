<script>
	import { Chart, registerables } from "chart.js";
	import "chartjs-adapter-date-fns";
	import { onMount } from "svelte";

	Chart.register(...registerables);

	let chartCanvas;
	let chart;

	// Sample data that matches the design
	const generateTimeData = () => {
		const now = new Date();
		const data = [];

		// Generate data for the last 24 hours
		for (let i = 24; i >= 0; i--) {
			const time = new Date(now.getTime() - i * 60 * 60 * 1000);
			data.push(time);
		}

		return data;
	};

	const timeLabels = generateTimeData();

	// Temperature data (matches the orange line in the screenshot)
	const temperatureData = [8, 12, 18, 25, 30, 35, 38, 40, 45, 48, 52, 55, 50, 45, 42, 38, 35, 32, 28, 25, 22, 20, 18, 15, 12];

	// Humidity data (matches the blue line in the screenshot)
	const humidityData = [15, 20, 22, 25, 30, 40, 50, 55, 60, 65, 68, 70, 65, 60, 55, 50, 45, 40, 35, 30, 28, 25, 22, 20, 18];

	onMount(() => {
		const ctx = chartCanvas.getContext("2d");

		chart = new Chart(ctx, {
			type: "line",
			data: {
				labels: timeLabels,
				datasets: [
					{
						label: "Temperature",
						data: temperatureData,
						borderColor: "#FF6B47",
						backgroundColor: "rgba(255, 107, 71, 0.1)",
						borderWidth: 2,
						pointRadius: 0,
						pointHoverRadius: 4,
						tension: 0.4,
						fill: false,
					},
					{
						label: "Humidity",
						data: humidityData,
						borderColor: "#4A90E2",
						backgroundColor: "rgba(74, 144, 226, 0.1)",
						borderWidth: 2,
						pointRadius: 0,
						pointHoverRadius: 4,
						tension: 0.4,
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
						max: 80,
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

	export { chart };
</script>

<div class="chart-container">
	<div class="chart-title">
		<span class="chart-indicator"></span>
		Humidity & Temperature Graph
	</div>
	<div class="chart-wrapper">
		<canvas bind:this={chartCanvas}></canvas>
	</div>
</div>
