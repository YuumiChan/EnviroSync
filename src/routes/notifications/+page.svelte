<script>
	import Sidebar from "$lib/components/Sidebar.svelte";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { onMount } from "svelte";

	let severeEvents = [];
	let offlineDevices = [];
	let earthquakeEvents = [];
	let loading = true;

	// Show more states
	let showAllEarthquake = false;
	let showAllSevere = false;
	let showAllOffline = false;

	async function fetchNotifications() {
		try {
			// Don't set loading=true after initial load to preserve scroll position
			const isInitialLoad = severeEvents.length === 0 && earthquakeEvents.length === 0 && offlineDevices.length === 0;
			if (isInitialLoad) {
				loading = true;
			}
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();

			// Load settings from localStorage for thresholds
			const savedSettings = localStorage.getItem("enviroSyncSettings");
			const settings = savedSettings
				? JSON.parse(savedSettings)
				: {
						tempSevere: 40,
						humidSevere: 90,
					};

			// Fetch severe status events using dynamic thresholds
			const severeQuery = `SELECT ts, ${deviceCol} as device, temp, humid FROM ${tableName} WHERE (temp > ${settings.tempSevere} OR humid > ${settings.humidSevere}) AND ts > dateadd('d', -7, now()) ORDER BY ts DESC LIMIT 50`;

			// Fetch devices that have been offline (no data in 30+ minutes) with last readings
			const offlineQuery = `SELECT ${deviceCol} as device, MAX(ts) as last_seen FROM ${tableName} GROUP BY ${deviceCol} HAVING MAX(ts) < dateadd('m', -30, now())`;

			// Fetch earthquake detection events (quake_flag = 2)
			const earthquakeQuery = `SELECT ts, ${deviceCol} as device, rms FROM ${tableName} WHERE quake_flag = 2 AND ts > dateadd('d', -7, now()) ORDER BY ts DESC LIMIT 50`;

			const [severeResponse, offlineResponse, earthquakeResponse] = await Promise.all([fetch(`/api/questdb?query=${encodeURIComponent(severeQuery)}`), fetch(`/api/questdb?query=${encodeURIComponent(offlineQuery)}`), fetch(`/api/questdb?query=${encodeURIComponent(earthquakeQuery)}`)]);

			if (severeResponse.ok) {
				const result = await severeResponse.json();
				if (result.dataset && result.dataset.length > 0) {
					severeEvents = result.dataset.map(([ts, device, temp, humid]) => {
						const timestampStr = ts.replace("Z", "");
						return {
							time: new Date(timestampStr),
							device,
							temp: parseFloat(temp).toFixed(2),
							humid: parseFloat(humid).toFixed(1),
						};
					});
				} else {
					severeEvents = [];
				}
			}

			if (offlineResponse.ok) {
				const result = await offlineResponse.json();
				if (result.dataset && result.dataset.length > 0) {
					// For each offline device, fetch its last readings
					const offlinePromises = result.dataset.map(async ([device, lastSeen]) => {
						const timestampStr = lastSeen.replace("Z", "");

						// Fetch last temp and humid for this device
						const lastDataQuery = `SELECT temp, humid FROM ${tableName} WHERE ${deviceCol}='${device}' ORDER BY ts DESC LIMIT 1`;
						const lastDataResponse = await fetch(`/api/questdb?query=${encodeURIComponent(lastDataQuery)}`);

						let lastTemp = "N/A";
						let lastHumid = "N/A";

						if (lastDataResponse.ok) {
							const lastDataResult = await lastDataResponse.json();
							if (lastDataResult.dataset && lastDataResult.dataset.length > 0) {
								lastTemp = parseFloat(lastDataResult.dataset[0][0]).toFixed(2);
								lastHumid = parseFloat(lastDataResult.dataset[0][1]).toFixed(1);
							}
						}

						return {
							device,
							lastSeen: new Date(timestampStr),
							lastTemp,
							lastHumid,
						};
					});

					offlineDevices = await Promise.all(offlinePromises);
				} else {
					offlineDevices = [];
				}
			}

			if (earthquakeResponse.ok) {
				const result = await earthquakeResponse.json();
				if (result.dataset && result.dataset.length > 0) {
					earthquakeEvents = result.dataset.map(([ts, device, rms]) => {
						const timestampStr = ts.replace("Z", "");
						return {
							time: new Date(timestampStr),
							device,
							rms: parseFloat(rms).toFixed(4),
						};
					});
				} else {
					earthquakeEvents = [];
				}
			}
		} catch (err) {
			console.error("Error fetching notifications:", err);
		} finally {
			loading = false;
		}
	}

	function formatDateTime(date) {
		return date.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		});
	}

	function formatRelativeTime(date) {
		const now = new Date();
		const diff = now - date;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
		if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
		if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
		return "Just now";
	}

	onMount(() => {
		fetchNotifications();
		// Refresh every 30 seconds
		const interval = setInterval(fetchNotifications, 30000);
		return () => clearInterval(interval);
	});
</script>

<Sidebar />

<main class="main-content">
	<div class="page-header">
		<h1>Notifications</h1>
		<p class="subtitle">System alerts and event history (last 7 days)</p>
	</div>

	{#if loading}
		<div class="loading">
			<div class="spinner"></div>
			<p>Loading notifications...</p>
		</div>
	{:else}
		<div class="notifications-grid">
			<!-- Earthquake Detections -->
			<div class="notification-section earthquake">
				<div class="section-header">
					<h2>
						<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
							<path d="M15.54 5.54L13.77 7.3 12 5.54 10.23 7.3 8.46 5.54 12 2zm5.23 5.23l-1.77-1.77L15.54 12l3.46 3.46 1.77-1.77-3.46-3.46zM8.46 18.46L12 22l3.54-3.54L13.77 16.7 12 18.46l-1.77-1.76zm-5.23-5.23L1.46 12l1.77 1.77L6.69 10.23 3.23 13.23z" />
						</svg>
						Earthquake Detections
					</h2>
					<span class="count">{earthquakeEvents.length}</span>
				</div>
				<div class="events-list">
					{#if earthquakeEvents.length === 0}
						<div class="no-events">No earthquake detections in the last 7 days</div>
					{:else}
						{#each showAllEarthquake ? earthquakeEvents : earthquakeEvents.slice(0, 3) as event}
							<div class="event-item">
								<div class="event-time">{formatDateTime(event.time)}</div>
								<div class="event-details">
									<span class="device-badge">{event.device}</span>
									<span class="metric">RMS: {event.rms}g</span>
								</div>
								<div class="event-relative">{formatRelativeTime(event.time)}</div>
							</div>
						{/each}
						{#if earthquakeEvents.length > 3}
							<button class="show-more-btn" on:click={() => (showAllEarthquake = !showAllEarthquake)}>
								{showAllEarthquake ? "Show Less" : `Show More (${earthquakeEvents.length - 3} more)`}
							</button>
						{/if}
					{/if}
				</div>
			</div>

			<!-- Severe Conditions -->
			<div class="notification-section severe">
				<div class="section-header">
					<h2>
						<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
							<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
						</svg>
						Severe Conditions
					</h2>
					<span class="count">{severeEvents.length}</span>
				</div>
				<div class="events-list">
					{#if severeEvents.length === 0}
						<div class="no-events">No severe conditions in the last 7 days</div>
					{:else}
						{#each showAllSevere ? severeEvents : severeEvents.slice(0, 3) as event}
							<div class="event-item">
								<div class="event-time">{formatDateTime(event.time)}</div>
								<div class="event-details">
									<span class="device-badge">{event.device}</span>
									<span class="metric">Temp: {event.temp}°C</span>
									<span class="metric">Humid: {event.humid}%</span>
								</div>
								<div class="event-relative">{formatRelativeTime(event.time)}</div>
							</div>
						{/each}
						{#if severeEvents.length > 3}
							<button class="show-more-btn" on:click={() => (showAllSevere = !showAllSevere)}>
								{showAllSevere ? "Show Less" : `Show More (${severeEvents.length - 3} more)`}
							</button>
						{/if}
					{/if}
				</div>
			</div>

			<!-- Offline Devices -->
			<div class="notification-section offline">
				<div class="section-header">
					<h2>
						<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
							<path d="M19.35 10.04C18.67 6.59 15.64 4 12 4c-1.48 0-2.85.43-4.01 1.17l1.46 1.46C10.21 6.23 11.08 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3 0 1.13-.64 2.11-1.56 2.62l1.45 1.45C23.16 18.16 24 16.68 24 15c0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.75 2.74C2.56 8.15 0 10.77 0 14c0 3.31 2.69 6 6 6h11.73l2 2L21 20.73 4.27 4 3 5.27zM7.73 10l8 8H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73z" />
						</svg>
						Offline Devices
					</h2>
					<span class="count">{offlineDevices.length}</span>
				</div>
				<div class="events-list">
					{#if offlineDevices.length === 0}
						<div class="no-events">All devices are online</div>
					{:else}
						{#each showAllOffline ? offlineDevices : offlineDevices.slice(0, 3) as device}
							<div class="event-item">
								<div class="event-time">Last seen: {formatDateTime(device.lastSeen)}</div>
								<div class="event-details">
									<span class="device-badge">{device.device}</span>
									<span class="metric offline-status">Offline</span>
								</div>
								<div class="last-data">
									<span class="metric">Last Temp: {device.lastTemp}°C</span>
									<span class="metric">Last Humid: {device.lastHumid}%</span>
								</div>
								<div class="event-relative">{formatRelativeTime(device.lastSeen)}</div>
							</div>
						{/each}
						{#if offlineDevices.length > 3}
							<button class="show-more-btn" on:click={() => (showAllOffline = !showAllOffline)}>
								{showAllOffline ? "Show Less" : `Show More (${offlineDevices.length - 3} more)`}
							</button>
						{/if}
					{/if}
				</div>
			</div>
		</div>
	{/if}
</main>

<style>
	.page-header {
		margin-bottom: 2rem;
	}

	.page-header h1 {
		font-size: 2rem;
		margin-bottom: 0.5rem;
		color: #fff;
	}

	.subtitle {
		color: #888;
		font-size: 1rem;
	}

	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 400px;
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

	.notifications-grid {
		display: grid;
		gap: 2rem;
	}

	.notification-section {
		background: rgba(0, 0, 0, 0.3);
		border-radius: 12px;
		padding: 1.5rem;
		border-left: 4px solid;
	}

	.notification-section.earthquake {
		border-left-color: #9c27b0;
	}

	.notification-section.severe {
		border-left-color: #ff0443;
	}

	.notification-section.offline {
		border-left-color: #a6a6a6;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.section-header h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.3rem;
		margin: 0;
		color: #fff;
	}

	.icon {
		width: 24px;
		height: 24px;
	}

	.count {
		background: rgba(255, 255, 255, 0.1);
		padding: 0.3rem 0.8rem;
		border-radius: 20px;
		font-weight: bold;
		font-size: 0.9rem;
	}

	.events-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.no-events {
		text-align: center;
		padding: 2rem;
		color: #666;
		font-style: italic;
	}

	.event-item {
		background: rgba(255, 255, 255, 0.05);
		padding: 1rem;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition: background 0.2s;
	}

	.event-item:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.event-time {
		font-size: 0.95rem;
		color: #b0b0b0;
		font-weight: 500;
	}

	.event-details {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.last-data {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		padding-top: 0.3rem;
		border-top: 1px dashed rgba(255, 255, 255, 0.1);
	}

	.device-badge {
		background: rgba(74, 144, 226, 0.2);
		color: #4a90e2;
		padding: 0.3rem 0.8rem;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.metric {
		color: #888;
		font-size: 0.9rem;
	}

	.show-more-btn {
		width: 100%;
		padding: 0.75rem;
		background: rgba(74, 144, 226, 0.1);
		border: 1px solid rgba(74, 144, 226, 0.3);
		color: #4a90e2;
		border-radius: 6px;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.show-more-btn:hover {
		background: rgba(74, 144, 226, 0.2);
		border-color: #4a90e2;
	}

	.offline-status {
		color: #a6a6a6;
		font-weight: 600;
	}

	.event-relative {
		font-size: 0.85rem;
		color: #666;
	}

	@media (max-width: 768px) {
		.notifications-grid {
			gap: 1.5rem;
		}

		.notification-section {
			padding: 1rem;
		}

		.section-header h2 {
			font-size: 1.1rem;
		}

		.event-details {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.5rem;
		}

		.last-data {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.3rem;
		}
	}
</style>
