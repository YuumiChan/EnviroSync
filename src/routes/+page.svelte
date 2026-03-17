<script>
	import DeviceSelector from "$lib/components/DeviceSelector.svelte";
	import MetricCards from "$lib/components/MetricCards.svelte";
	import TemperatureHumidityChart from "$lib/components/TemperatureHumidityChart.svelte";
	import { onMount } from "svelte";

	let selectedDevice = null;
	let showDashboard = false;

	function handleDeviceSelection(event) {
		selectedDevice = event.detail.deviceId;
		showDashboard = true;

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

{#if !showDashboard}
	<div class="dashboard-header">
		<div>
			<h1 class="dashboard-title">Dashboard Summary</h1>
		</div>
	</div>

	<DeviceSelector on:deviceSelected={handleDeviceSelection} />
{:else}
	<div class="dashboard-content">
		<div class="dashboard-layout">
			<div class="metrics-column">
				<button class="back-button" on:click={goBackToDeviceSelector}>&larr; Back to Devices</button>
				<div class="metrics-sidebar">
					<MetricCards {selectedDevice} />
				</div>
			</div>
			<div class="charts-column">
				<div class="chart-section">
					<TemperatureHumidityChart {selectedDevice} rmsMode={false} />
				</div>
				<div class="chart-section">
					<TemperatureHumidityChart {selectedDevice} rmsMode={true} />
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.dashboard-content {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: calc(100vh - 5rem);
	}

	.dashboard-layout {
		display: grid;
		grid-template-columns: 300px 1fr;
		gap: 1rem;
		flex: 1;
		min-height: 0;
	}

	.metrics-column {
		display: flex;
		flex-direction: column;
		min-height: 0;
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
		text-align: left;
		margin-bottom: 0.75rem;
		flex-shrink: 0;
	}

	.back-button:hover {
		border-color: var(--text-muted);
		color: var(--text-primary);
	}

	.metrics-sidebar {
		flex: 1;
		min-height: 0;
	}

	.charts-column {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 0;
	}

	.chart-section {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* Mobile layout */
	@media (max-width: 900px) {
		.dashboard-content {
			height: auto;
		}

		.dashboard-layout {
			grid-template-columns: 1fr;
		}

		.metrics-column {
			display: contents;
		}

		.back-button {
			order: -1;
		}

		.metrics-sidebar {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 0.5rem;
		}

		.chart-section {
			min-height: 300px;
			overflow: visible;
		}
	}
</style>
