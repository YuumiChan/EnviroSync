<script>
	import { filterVisibleDevices } from "$lib/deviceFilter.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { createEventDispatcher, onMount } from "svelte";
	import RmsCard from "./RmsCard.svelte";

	const dispatch = createEventDispatcher();

	let devices = [];
	let loading = true;
	let error = null;

	// Device data with current readings
	let deviceData = {};

	async function fetchDevices() {
		try {
			console.log("Fetching available devices...");

			// Fetch directly from API without caching
			await fetchDevicesFromAPI();
		} catch (err) {
			console.error("Error in fetchDevices:", err);
			error = "Something is wrong";
			devices = [];
			loading = false;
		}
	}

	async function fetchDevicesFromAPI() {
		try {
			// Determine device column and get distinct device IDs
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();
			const devicesQuery = `SELECT DISTINCT ${deviceCol} FROM ${tableName}`;
			const devicesResponse = await fetch(`/api/questdb?query=${encodeURIComponent(devicesQuery)}`);

			if (devicesResponse.ok) {
				const devicesResult = await devicesResponse.json();
				console.log("Devices result:", devicesResult);

				if (devicesResult.dataset && devicesResult.dataset.length > 0) {
					const allDevices = devicesResult.dataset.map((row) => row[0]).sort();
					console.log("Found all devices (sorted):", allDevices);

					// Filter out hidden devices
					const freshDevices = filterVisibleDevices(allDevices);
					console.log("Visible devices after filtering:", freshDevices);

					devices = freshDevices;
					error = null;

					// Fetch current data for each device
					await fetchDeviceData();
				} else {
					// No data found
					console.log("No devices found in database");
					error = "Something is wrong";
					devices = [];
				}
			} else {
				console.error("Failed to fetch devices");
				error = "Something is wrong";
				devices = [];
			}
		} catch (err) {
			console.error("Error fetching devices from API:", err);
			error = "Something is wrong";
			devices = [];
		} finally {
			loading = false;
		}
	}

	async function fetchDeviceData() {
		try {
			// Load settings from localStorage
			const savedSettings = localStorage.getItem("enviroSyncSettings");
			const settings = savedSettings
				? JSON.parse(savedSettings)
				: {
						tempNormalMin: 18,
						tempNormalMax: 35,
						tempSevere: 40,
						humidNormalMin: 30,
						humidNormalMax: 80,
						humidSevere: 90,
						rmsEarthquakeThreshold: 0.05,
					};

			const promises = devices.map(async (deviceId) => {
				const deviceColName = await getDeviceColumnName();
				const deviceCol = getQuotedColumn(deviceColName);
				const tableName = getTableName();
				const query = `SELECT temp, humid, ts FROM ${tableName} WHERE ${deviceCol}='${deviceId}' ORDER BY ts DESC LIMIT 1`;
				const response = await fetch(`/api/questdb?query=${encodeURIComponent(query)}`);

				if (response.ok) {
					const result = await response.json();
					if (result.dataset && result.dataset.length > 0) {
						const [temp, humid, timestamp] = result.dataset[0];
						// Treat database timestamp as already in local time (UTC+8)
						const lastUpdate = new Date(timestamp);
						const now = new Date();
						const minutesSinceLastUpdate = (now - lastUpdate) / 1000 / 60;

						// Determine status using localStorage settings
						let status = "Normal";
						if (minutesSinceLastUpdate > 30) {
							status = "Offline";
						} else {
							const t = parseFloat(temp);
							const h = parseFloat(humid);
							const tempNormal = t >= settings.tempNormalMin && t <= settings.tempNormalMax;
							const humidNormal = h >= settings.humidNormalMin && h <= settings.humidNormalMax;

							if (tempNormal && humidNormal) {
								status = "Normal";
							} else if (t > settings.tempSevere || h > settings.humidSevere) {
								status = "Severe";
							} else {
								status = "Warning";
							}
						}

						const deviceData = {
							deviceId,
							temperature: parseFloat(temp).toFixed(2),
							humidity: parseFloat(humid).toFixed(1),
							lastUpdate,
							status,
						};

						return deviceData;
					}
				}

				// Return fallback data if no real data
				return {
					deviceId,
					temperature: "29.70",
					humidity: "87.0",
					lastUpdate: new Date(),
					status: "Offline",
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
				temperature: "29.70",
				humidity: "87.0",
				lastUpdate: new Date(),
				status: "Offline",
			};
		});
	}

	// Get background color based on status
	function getStatusColor(status) {
		switch (status) {
			case "Normal":
				return "#333333";
			case "Warning":
				return "#dde26a";
			case "Severe":
				return "#ff0443";
			case "Offline":
				return "#a6a6a6";
			default:
				return "#333333";
		}
	}

	// Check if device data is older than 5 minutes
	function isDeviceDataStale(deviceId) {
		const data = deviceData[deviceId];
		if (!data || !data.lastUpdate) return true;

		const now = new Date();
		const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
		return data.lastUpdate < fiveMinutesAgo;
	}

	function selectDevice(deviceId) {
		dispatch("deviceSelected", { deviceId });
	}

	onMount(() => {
		fetchDevices();

		// Set up automatic refresh every 3 seconds for device list
		const interval = setInterval(fetchDevices, 3000);
		return () => clearInterval(interval);
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
			<div class="rms-card-wrapper">
				<RmsCard on:showEarthquakeGraph />
			</div>
			{#each devices as deviceId}
				<button class="device-card" class:stale-data={isDeviceDataStale(deviceId)} style="background-color: {getStatusColor(deviceData[deviceId]?.status || 'Normal')};" on:click={() => selectDevice(deviceId)}>
					<div class="device-header">
						<h3>{deviceId}</h3>
					</div>

					<div class="device-metrics">
						<div class="metric">
							<div class="metric-value temperature">
								{deviceData[deviceId]?.temperature || "??.??"}°C
							</div>
						</div>

						<div class="metric">
							<div class="metric-value humidity">
								{deviceData[deviceId]?.humidity || "??.?"}%
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
		grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
		gap: 2rem;
		margin-top: 2rem;
	}

	.device-card {
		background: #2d2d2d;
		border: 1px solid #404040;
		border-radius: 12px;
		padding: 2.5rem;
		cursor: pointer;
		transition: all 0.3s ease;
		text-align: left;
		color: inherit;
		font-family: inherit;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-height: 200px;
	}

	.device-card:hover {
		border-color: #4a90e2;
		background: #333;
		transform: translateY(-2px);
		box-shadow: 0 4px 20px rgba(74, 144, 226, 0.2);
	}

	.device-card.stale-data {
		background: rgba(255, 255, 255, 0.95);
		color: #333;
		border-color: rgba(200, 200, 200, 0.8);
	}

	.device-card.stale-data:hover {
		background: rgba(255, 255, 255, 1);
		border-color: #999;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
	}

	.device-card.stale-data .device-header h3 {
		color: #333;
	}

	.device-header h3 {
		font-size: 1.8rem;
		font-weight: 600;
		margin: 0;
		color: #fff;
		text-align: center;
	}

	.device-metrics {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		align-items: center;
	}

	.metric {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		justify-content: center;
		width: 100%;
	}

	.metric-value {
		font-size: 2.4rem;
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
			gap: 1.5rem;
			margin-top: 1rem;
		}

		.device-card {
			padding: 2rem;
			min-height: 180px;
		}
	}
</style>
