<script>
	import DateTimeDisplay from "$lib/components/DateTimeDisplay.svelte";
	import MetricCards from "$lib/components/MetricCards.svelte";
	import Sidebar from "$lib/components/Sidebar.svelte";
	import TemperatureHumidityChart from "$lib/components/TemperatureHumidityChart.svelte";
</script>

<Sidebar />

<main class="main-content">
	<div class="dashboard-header">
		<div>
			<h1 class="dashboard-title">Dashboard Summary</h1>
			<p class="dashboard-subtitle">Welcome, it's great to see you again.</p>
		</div>

		<div class="user-info">
			<div class="connection-status">
				<div class="status-dot"></div>
				<span>Connected</span>
			</div>
			<div class="username">Sir Renz</div>
			<div class="user-avatar">R</div>
		</div>
	</div>

	<TemperatureHumidityChart />

	<div class="bottom-section">
		<DateTimeDisplay />
		<MetricCards />
	</div>
</main>
