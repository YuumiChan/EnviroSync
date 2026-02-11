<script>
	import ConnectionStatus from "$lib/components/ConnectionStatus.svelte";
	import DeviceSelector from "$lib/components/DeviceSelector.svelte";
	import MetricCards from "$lib/components/MetricCards.svelte";
	import Sidebar from "$lib/components/Sidebar.svelte";
	import TemperatureHumidityChart from "$lib/components/TemperatureHumidityChart.svelte";
	import { onMount } from "svelte";

	let selectedDevice = null;
	let showDashboard = false;

	function handleDeviceSelection(event) {
		selectedDevice = event.detail.deviceId;
		showDashboard = true;
		console.log("Selected device:", selectedDevice);

		// Push state to browser history
		history.pushState({ device: selectedDevice }, "", `?device=${encodeURIComponent(selectedDevice)}`);
	}

	function goBackToDeviceSelector() {
		showDashboard = false;
		selectedDevice = null;

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
		}
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
			</div>
		</div>

		<DeviceSelector on:deviceSelected={handleDeviceSelection} />
	{:else}
		<div class="breadcrumb">
			<button class="back-button" on:click={goBackToDeviceSelector}> ← Back to Devices </button>
		</div>

		<div class="dashboard-content">
			<div class="chart-section">
				<TemperatureHumidityChart {selectedDevice} />
			</div>

			<div class="metrics-section">
				<MetricCards {selectedDevice} />
			</div>
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

	.dashboard-content {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		height: calc(100vh - 200px);
	}

	.chart-section {
		flex: 4;
		min-height: 0;
	}

	.metrics-section {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
		width: 100%;
		align-items: start;
	}

	@media (max-width: 1200px) {
		.metrics-section {
			grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		}
	}

	@media (max-width: 768px) {
		.metrics-section {
			grid-template-columns: 1fr;
			gap: 0.75rem;
		}
	}
</style>
