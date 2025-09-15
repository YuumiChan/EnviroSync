<script>
	import DateTimeDisplay from "$lib/components/DateTimeDisplay.svelte";
	import DeviceSelector from "$lib/components/DeviceSelector.svelte";
	import MetricCards from "$lib/components/MetricCards.svelte";
	import Sidebar from "$lib/components/Sidebar.svelte";
	import TemperatureHumidityChart from "$lib/components/TemperatureHumidityChart.svelte";
	import ConnectionStatus from "$lib/components/ConnectionStatus.svelte";

	let selectedDevice = null;
	let showDashboard = false;

	function handleDeviceSelection(event) {
		selectedDevice = event.detail.deviceId;
		showDashboard = true;
		console.log("Selected device:", selectedDevice);
	}

	function goBackToDeviceSelector() {
		showDashboard = false;
		selectedDevice = null;
	}
</script>

<Sidebar />

<main class="main-content">
	{#if !showDashboard}
		<div class="dashboard-header">
			<div>
				<h1 class="dashboard-title">Dashboard Summary</h1>
				<p class="dashboard-subtitle">Welcome, it's great to see you again.</p>
			</div>

			<div class="user-info">
				<ConnectionStatus />
				<div class="username">Sir Renz</div>
				<div class="user-avatar">R</div>
			</div>
		</div>

		<DeviceSelector on:deviceSelected={handleDeviceSelection} />
	{:else}
		<div class="breadcrumb">
			<button class="back-button" on:click={goBackToDeviceSelector}> ← Back to Devices </button>
		</div>

		<TemperatureHumidityChart {selectedDevice} />

		<div class="metrics-section">
			<DateTimeDisplay />
			<MetricCards {selectedDevice} />
		</div>
	{/if}
</main>

<style>
	.breadcrumb {
		margin-bottom: 1.5rem;
	}

	.back-button {
		background: none;
		border: 1px solid #404040;
		color: #888;
		padding: 0.5rem 1rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.2s ease;
	}

	.back-button:hover {
		border-color: #4a90e2;
		color: #4a90e2;
		background: rgba(74, 144, 226, 0.1);
	}

	.metrics-section {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		margin-top: 2rem;
	}

	@media (max-width: 1200px) {
		.metrics-section {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 768px) {
		.metrics-section {
			grid-template-columns: 1fr;
		}
	}
</style>
