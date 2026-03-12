<script>
	import ConnectionStatus from "$lib/components/ConnectionStatus.svelte";
	import DeviceSelector from "$lib/components/DeviceSelector.svelte";
	import MetricCards from "$lib/components/MetricCards.svelte";
	import TemperatureHumidityChart from "$lib/components/TemperatureHumidityChart.svelte";
	import { onMount } from "svelte";

	let selectedDevice = null;
	let showDashboard = false;
	let rmsMode = false;

	function handleDeviceSelection(event) {
		selectedDevice = event.detail.deviceId;
		showDashboard = true;

		// Push state to browser history
		history.pushState({ device: selectedDevice }, "", `?device=${encodeURIComponent(selectedDevice)}`);
	}

	function goBackToDeviceSelector() {
		showDashboard = false;
		selectedDevice = null;
		rmsMode = false;

		// Update URL without device parameter
		history.pushState({}, "", window.location.pathname);
	}

	function handlePopState(event) {
		if (event.state && event.state.device) {
			selectedDevice = event.state.device;
			showDashboard = true;
		} else {
			showDashboard = false;
			selectedDevice = null;
			rmsMode = false;
		}
	}

	function handleRmsModeChange(event) {
		rmsMode = event.detail.rmsMode;
	}

	onMount(() => {
		// Handle browser back/forward buttons
		window.addEventListener("popstate", handlePopState);

		// Check URL for device parameter on page load
		const params = new URLSearchParams(window.location.search);
		const device = params.get("device");
		if (device) {
			selectedDevice = device;
			showDashboard = true;
		}

		return () => {
			window.removeEventListener("popstate", handlePopState);
		};
	});
</script>

{#if !showDashboard}
	<div class="dashboard-header">
		<div>
			<h1 class="dashboard-title">Dashboard Summary</h1>
		</div>

		<div class="user-info">
			<ConnectionStatus />
		</div>
	</div>

	<DeviceSelector on:deviceSelected={handleDeviceSelection} />
{:else}
	<div class="dashboard-content">
		<div class="chart-section">
			<TemperatureHumidityChart {selectedDevice} {rmsMode} onBackToDevices={goBackToDeviceSelector} />
		</div>

		<div class="metrics-section">
			<MetricCards {selectedDevice} on:rmsModeChange={handleRmsModeChange} />
		</div>
	</div>
{/if}

<style>
	.dashboard-content {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		width: 100%;
	}

	.chart-section {
		width: 100%;
		max-height: 500px;
		min-height: 400px;
		overflow: hidden;
		position: relative;
	}

	.metrics-section {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
		width: 100%;
		align-items: start;
		margin-top: 1rem;
	}

	@media (max-width: 1200px) {
		.metrics-section {
			grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		}

		.chart-section {
			max-height: 450px;
			min-height: 350px;
		}
	}

	@media (max-width: 768px) {
		.dashboard-content {
			gap: 1rem;
		}

		.chart-section {
			max-height: none;
			min-height: 250px;
			overflow: visible;
		}

		.metrics-section {
			grid-template-columns: 1fr;
			gap: 0.75rem;
			margin-top: 0;
		}
	}
</style>
