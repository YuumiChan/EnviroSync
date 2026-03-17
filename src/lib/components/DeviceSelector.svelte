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
			const sharedRaw = localStorage.getItem("enviroSyncSharedSettings");
			const legacyRaw = localStorage.getItem("enviroSyncSettings");
			const shared = sharedRaw ? JSON.parse(sharedRaw) : {};
			const legacy = legacyRaw ? JSON.parse(legacyRaw) : {};
			const settings = {
				tempNormalMin: shared.tempNormalMin ?? legacy.tempNormalMin ?? 18,
				tempNormalMax: shared.tempNormalMax ?? legacy.tempNormalMax ?? 35,
				tempSevere: shared.tempSevere ?? legacy.tempSevere ?? 40,
				humidNormalMin: shared.humidNormalMin ?? legacy.humidNormalMin ?? 30,
				humidNormalMax: shared.humidNormalMax ?? legacy.humidNormalMax ?? 80,
				humidSevere: shared.humidSevere ?? legacy.humidSevere ?? 90,
				rmsEarthquakeThreshold: shared.rmsEarthquakeThreshold ?? legacy.rmsEarthquakeThreshold ?? 0.05,
				weakEarthquakeThreshold: shared.weakEarthquakeThreshold ?? legacy.weakEarthquakeThreshold ?? 0.01,
				strongEarthquakeThreshold: shared.strongEarthquakeThreshold ?? legacy.strongEarthquakeThreshold ?? 0.1,
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
						let severeLabels = [];
						if (minutesSinceLastUpdate > 30) {
							status = "Offline";
						} else {
							const t = parseFloat(temp);
							const h = parseFloat(humid);
							const r = rms !== null ? parseFloat(rms) : 0;

							if (t > settings.tempSevere) severeLabels.push("TEMP");
							if (h > settings.humidSevere) severeLabels.push("HUMI");
							if (r >= (settings.strongEarthquakeThreshold || 0.1)) severeLabels.push("SIES");

							if (severeLabels.length > 0) {
								status = "Severe";
							}
						}

						return {
							deviceId,
							temperature: parseFloat(temp).toFixed(2),
							humidity: parseFloat(humid).toFixed(1),
							rms: rms !== null ? parseFloat(rms) : 0,
							lastUpdate,
							status,
							severeLabels,
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
				severeLabels: [],
			};
		});
	}

	function getStatusColor(status) {
		switch (status) {
			case "Normal":
				return "var(--bg-card)";
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
		const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
		return data.lastUpdate < thirtyMinutesAgo;
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
							<div class="metric-value">{deviceData[deviceId]?.temperature || "??.??"}°C</div>
							<div class="metric-value">{deviceData[deviceId]?.humidity || "??.?"}%</div>
							<div class="metric-value">{formatRmsValue(deviceData[deviceId]?.rms || 0)}</div>
						{/if}
					</div>

					{#if deviceData[deviceId]?.severeLabels?.length > 0}
						<div class="severe-labels">
							{#each deviceData[deviceId].severeLabels as label}
								<span class="severe-tag">{label}</span>
							{/each}
						</div>
					{/if}
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
		grid-template-columns: repeat(3, 1fr);
		gap: 1.5rem;
		margin-top: 2rem;
	}

	.device-card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1.5rem;
		cursor: pointer;
		transition: all 0.3s ease;
		text-align: left;
		color: inherit;
		font-family: inherit;
		display: flex;
		flex-direction: column;
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
		font-size: 1.4rem;
		font-weight: 600;
		margin: 0 0 1rem 0;
		color: var(--text-primary);
	}

	.device-metrics {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		flex: 1;
	}

	.metric-value {
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.offline-message {
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--text-muted);
		text-align: center;
		padding: 1rem 0;
	}

	.severe-labels {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid rgba(255, 255, 255, 0.15);
	}

	.severe-tag {
		background: rgba(255, 255, 255, 0.25);
		color: #fff;
		font-size: 0.8rem;
		font-weight: 700;
		padding: 0.25rem 0.75rem;
		border-radius: 4px;
		letter-spacing: 0.05em;
		flex: 1;
		text-align: center;
	}

	@media (max-width: 900px) {
		.devices-grid {
			grid-template-columns: 1fr;
			gap: 1rem;
			margin-top: 1rem;
		}

		.device-card {
			padding: 1.25rem;
		}
	}
</style>
