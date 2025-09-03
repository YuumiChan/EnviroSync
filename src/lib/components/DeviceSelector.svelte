<script>
	import { createEventDispatcher, onMount } from "svelte";

	const dispatch = createEventDispatcher();

	let devices = [];
	let loading = true;
	let error = null;

	// Device data with current readings
	let deviceData = {};

	async function fetchDevices() {
		try {
			console.log("Fetching available devices...");

			// Get distinct device IDs
			const devicesQuery = `SELECT DISTINCT device_id FROM hawak WHERE is_deleted != true`;
			const devicesResponse = await fetch(`/api/questdb?query=${encodeURIComponent(devicesQuery)}`);

			if (devicesResponse.ok) {
				const devicesResult = await devicesResponse.json();
				console.log("Devices result:", devicesResult);

				if (devicesResult.dataset && devicesResult.dataset.length > 0) {
					devices = devicesResult.dataset.map((row) => row[0]).sort(); // Sort alphabetically
					console.log("Found devices (sorted):", devices);

					// Fetch current data for each device
					await fetchDeviceData();
				} else {
					// Fallback devices if no data
					devices = ["AHT10", "DHT11", "DHT22"].sort(); // Sort alphabetically
					console.log("Using fallback devices");
					setFallbackData();
				}
			} else {
				console.error("Failed to fetch devices");
				devices = ["AHT10", "DHT11", "DHT22"].sort(); // Sort alphabetically
				setFallbackData();
			}
		} catch (err) {
			console.error("Error fetching devices:", err);
			error = err.message;
			devices = ["AHT10", "DHT11", "DHT22"].sort(); // Sort alphabetically
			setFallbackData();
		} finally {
			loading = false;
		}
	}

	async function fetchDeviceData() {
		try {
			const promises = devices.map(async (deviceId) => {
				const query = `SELECT temperature, humidity, ts FROM hawak WHERE device_id='${deviceId}' ORDER BY ts DESC LIMIT 1`;
				const response = await fetch(`/api/questdb?query=${encodeURIComponent(query)}`);

				if (response.ok) {
					const result = await response.json();
					if (result.dataset && result.dataset.length > 0) {
						const [temp, humid, timestamp] = result.dataset[0];
						return {
							deviceId,
							temperature: parseFloat(temp).toFixed(1),
							humidity: Math.round(parseFloat(humid)),
							lastUpdate: new Date(timestamp),
						};
					}
				}

				// Return fallback data if no real data
				return {
					deviceId,
					temperature: "29.7",
					humidity: 87,
					lastUpdate: new Date(),
				};
			});

			const results = await Promise.all(promises);
			results.forEach((data) => {
				deviceData[data.deviceId] = data;
			});
		} catch (err) {
			console.error("Error fetching device data:", err);
			setFallbackData();
		}
	}

	function setFallbackData() {
		devices.forEach((deviceId) => {
			deviceData[deviceId] = {
				deviceId,
				temperature: "29.7",
				humidity: 87,
				lastUpdate: new Date(),
			};
		});
	}

	function selectDevice(deviceId) {
		dispatch("deviceSelected", { deviceId });
	}

	onMount(() => {
		fetchDevices();
	});
</script>

<div class="device-selector">
	{#if loading}
		<div class="loading">
			<div class="spinner"></div>
			<p>Loading devices...</p>
		</div>
	{:else if error}
		<div class="error">
			<p>Error loading devices: {error}</p>
			<button on:click={fetchDevices}>Retry</button>
		</div>
	{:else}
		<div class="devices-grid">
			{#each devices as deviceId}
				<button class="device-card" on:click={() => selectDevice(deviceId)}>
					<div class="device-header">
						<h3>{deviceId}</h3>
					</div>

					<div class="device-metrics">
						<div class="metric">
							<div class="metric-icon">🌡️</div>
							<div class="metric-value temperature">
								{deviceData[deviceId]?.temperature || "29.7"}°C
							</div>
						</div>

						<div class="metric">
							<div class="metric-icon">💧</div>
							<div class="metric-value humidity">
								{deviceData[deviceId]?.humidity || 87}%
							</div>
						</div>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.device-selector {
		padding: 0;
		color: #fff;
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
		border-top: 4px solid #4a90e2;
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

	.error {
		text-align: center;
		padding: 2rem;
		color: #ff6b6b;
	}

	.error button {
		background: #4a90e2;
		color: white;
		border: none;
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		cursor: pointer;
		font-size: 1rem;
		margin-top: 1rem;
		transition: background 0.2s;
	}

	.error button:hover {
		background: #357abd;
	}

	.devices-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1.5rem;
		margin-top: 2rem;
	}

	.device-card {
		background: #2d2d2d;
		border: 1px solid #404040;
		border-radius: 12px;
		padding: 1.5rem;
		cursor: pointer;
		transition: all 0.3s ease;
		text-align: left;
		color: inherit;
		font-family: inherit;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.device-card:hover {
		border-color: #4a90e2;
		background: #333;
		transform: translateY(-2px);
		box-shadow: 0 4px 20px rgba(74, 144, 226, 0.2);
	}

	.device-header h3 {
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0;
		color: #fff;
		text-align: center;
	}

	.device-metrics {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		align-items: center;
	}

	.metric {
		display: flex;
		align-items: center;
		gap: 1rem;
		justify-content: center;
		width: 100%;
	}

	.metric-icon {
		font-size: 1.8rem;
		opacity: 0.9;
		width: 2.5rem;
		text-align: center;
	}

	.metric-value {
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.metric-value.temperature {
		color: #ff6b47;
	}

	.metric-value.humidity {
		color: #4a90e2;
	}

	@media (max-width: 768px) {
		.devices-grid {
			grid-template-columns: 1fr;
			gap: 1rem;
			margin-top: 1rem;
		}

		.device-card {
			padding: 1.5rem;
		}
	}
</style>
