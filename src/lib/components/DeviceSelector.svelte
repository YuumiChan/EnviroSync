<script>
	import { filterVisibleDevices } from "$lib/deviceFilter.js";
	import { rmsToMagnitude } from "$lib/magnitude.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { magnitudeMode } from "$lib/stores.js";
	import { createEventDispatcher, onMount } from "svelte";

	const dispatch = createEventDispatcher();

	let devices = [];
	let loading = true;
	let error = null;

	// Device data with current readings
	let deviceData = {};

	async function fetchDevices() {
		try {
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
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();
			const devicesQuery = `SELECT DISTINCT ${deviceCol} FROM ${tableName}`;
			const devicesResponse = await fetch(`/api/questdb?query=${encodeURIComponent(devicesQuery)}`);

			if (devicesResponse.ok) {
				const devicesResult = await devicesResponse.json();

				if (devicesResult.dataset && devicesResult.dataset.length > 0) {
					const allDevices = devicesResult.dataset.map((row) => row[0]).sort();
					const freshDevices = filterVisibleDevices(allDevices);
					devices = freshDevices;
					error = null;
					await fetchDeviceData();
				} else {
					error = "Something is wrong";
					devices = [];
				}
			} else {
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
						weakEarthquakeThreshold: 0.01,
						strongEarthquakeThreshold: 0.1,
					};

			const promises = devices.map(async (deviceId) => {
				const deviceColName = await getDeviceColumnName();
				const deviceCol = getQuotedColumn(deviceColName);
				const tableName = getTableName();
				const query = `SELECT temp, humid, ts, rms, quake_flag FROM ${tableName} WHERE ${deviceCol}='${deviceId}' ORDER BY ts DESC LIMIT 1`;
				const response = await fetch(`/api/questdb?query=${encodeURIComponent(query)}`);

				if (response.ok) {
					const result = await response.json();
					if (result.dataset && result.dataset.length > 0) {
						const [temp, humid, timestamp, rms] = result.dataset[0];
						const lastUpdate = new Date(timestamp);
						const now = new Date();
						const minutesSinceLastUpdate = (now - lastUpdate) / 1000 / 60;

						let status = "Normal";
						if (minutesSinceLastUpdate > 5) {
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

						return {
							deviceId,
							temperature: parseFloat(temp).toFixed(2),
							humidity: parseFloat(humid).toFixed(1),
							rms: rms !== null ? parseFloat(rms) : 0,
							lastUpdate,
							status,
						};
					}
				}

				return {
					deviceId,
					temperature: "29.70",
					humidity: "87.0",
					rms: 0,
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
				rms: 0,
				lastUpdate: new Date(),
				status: "Offline",
			};
		});
	}

	function getStatusColor(status) {
		switch (status) {
			case "Normal":
				return "var(--bg-card)";
			case "Warning":
				return "#dde26a";
			case "Severe":
				return "#ff0443";
			case "Offline":
				return "var(--bg-secondary)";
			default:
				return "var(--bg-card)";
		}
	}

	function isDeviceDataStale(deviceId) {
		const data = deviceData[deviceId];
		if (!data || !data.lastUpdate) return true;

		const now = new Date();
		const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
		return data.lastUpdate < fiveMinutesAgo;
	}

	function formatRmsValue(rms) {
		if ($magnitudeMode) {
			return `${rmsToMagnitude(rms).toFixed(1)} Mag`;
		}
		return `${rms.toFixed(3)}g`;
	}

	function selectDevice(deviceId) {
		dispatch("deviceSelected", { deviceId });
	}

	onMount(() => {
		fetchDevices();
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
			{#each devices as deviceId}
				<button class="device-card" class:stale-data={isDeviceDataStale(deviceId)} style="background-color: {getStatusColor(deviceData[deviceId]?.status || 'Normal')};" on:click={() => selectDevice(deviceId)}>
					<div class="device-header">
						<h3>{deviceId}</h3>
					</div>

					<div class="device-metrics">
						{#if deviceData[deviceId]?.status === "Offline"}
							<div class="offline-message">Offline</div>
						{:else}
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

							<div class="metric">
								<div class="metric-value seismic">
									{formatRmsValue(deviceData[deviceId]?.rms || 0)}
								</div>
							</div>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.device-selector {
		padding: 0;
		color: var(--text-primary);
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
		border: 4px solid var(--border-color);
		border-top: 4px solid var(--accent-blue);
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
		color: var(--accent-red, #e65050);
	}

	.error button {
		background: var(--accent-blue);
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
		opacity: 0.9;
	}

	.devices-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
		gap: 2rem;
		margin-top: 2rem;
	}

	.device-card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
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
		border-color: var(--accent-blue);
		transform: translateY(-2px);
		box-shadow: 0 4px 20px rgba(57, 158, 230, 0.15);
	}

	.device-card.stale-data {
		opacity: 0.7;
	}

	.device-header h3 {
		font-size: 1.8rem;
		font-weight: 600;
		margin: 0;
		color: var(--text-primary);
		text-align: left;
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
		color: var(--text-primary);
	}

	.metric-value.humidity {
		color: var(--text-primary);
	}

	.metric-value.seismic {
		color: var(--text-primary);
		font-size: 2.4rem;
	}

	.offline-message {
		font-size: 2.4rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text-muted);
		text-align: center;
		width: 100%;
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
