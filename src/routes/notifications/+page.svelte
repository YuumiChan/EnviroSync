<script>
	import { localNow } from "$lib/config.js";
	import { getHiddenDeviceIds } from "$lib/deviceFilter.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { onMount } from "svelte";

	let severeEvents = [];
	let earthquakeEvents = [];
	let loading = true;

	// Show more states
	let showAllEarthquake = false;
	let showAllSevere = false;

	// Group consecutive time-buckets into distinct earthquake events.
	// If the gap between two buckets exceeds gapMs a new event is started.
	function groupIntoEvents(dataset, gapMs = 10 * 60 * 1000) {
		if (!dataset || dataset.length === 0) return [];

		const events = [];
		let cur = null;

		for (const row of dataset) {
			// DB timestamps are stored as local time; strip trailing Z so the browser
			// does not re-interpret them as UTC and shift them again.
			const time = new Date(String(row[0]).replace("Z", ""));
			const rms = parseFloat(row[1]);

			if (!cur || time.getTime() - cur.end.getTime() > gapMs) {
				if (cur) events.push(cur);
				cur = { start: time, end: time, peakRms: rms };
			} else {
				cur.end = time;
				cur.peakRms = Math.max(cur.peakRms, rms);
			}
		}
		if (cur) events.push(cur);

		return events;
	}

	async function fetchNotifications() {
		console.log("Notifications: fetchNotifications called");
		try {
			// Don't set loading=true after initial load to preserve scroll position
			const isInitialLoad = severeEvents.length === 0 && earthquakeEvents.length === 0;
			if (isInitialLoad) {
				loading = true;
			}
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();
			console.log("Notifications: tableName =", tableName, "deviceCol =", deviceCol);

			// Load settings from localStorage for thresholds
			const savedSettings = localStorage.getItem("enviroSyncSettings");
			const settings = savedSettings
				? JSON.parse(savedSettings)
				: {
						tempSevere: 40,
						humidSevere: 90,
						weakEarthquakeThreshold: 0.01,
						strongEarthquakeThreshold: 0.1,
					};

			// Exclude hidden devices (treat same as offline)
			const hiddenIds = getHiddenDeviceIds();
			const hiddenFilter = hiddenIds.length > 0 ? `AND ${deviceCol} NOT IN (${hiddenIds.map((id) => `'${id}'`).join(",")})` : "";

			// Fetch severe status events using dynamic thresholds
			const severeQuery = `SELECT ts, ${deviceCol} as device, temp, humid FROM ${tableName} WHERE (temp > ${settings.tempSevere} OR humid > ${settings.humidSevere}) ${hiddenFilter} AND ts > dateadd('d', -7, ${localNow()}) AND ts <= ${localNow()} ORDER BY ts DESC LIMIT 50`;

			// Fetch earthquake events: simple query for all quake_flag = 2
			const earthquakeQuery = `
				SELECT timestamp_floor('5m', ts) as bucket, MAX(rms) as peak_rms
				FROM ${tableName}
				WHERE quake_flag = 2 AND ts > dateadd('d', -7, ${localNow()}) AND ts <= ${localNow()} ${hiddenFilter}
				GROUP BY bucket
				ORDER BY bucket ASC
			`;

			console.log("Notifications earthquake query:", earthquakeQuery);
			const [severeResponse, earthquakeResponse] = await Promise.all([fetch(`/api/questdb?query=${encodeURIComponent(severeQuery)}`), fetch(`/api/questdb?query=${encodeURIComponent(earthquakeQuery)}`)]);

			if (severeResponse.ok) {
				const result = await severeResponse.json();
				if (result.dataset && result.dataset.length > 0) {
					severeEvents = result.dataset.map(([ts, device, temp, humid]) => {
						// Strip Z so local-time DB timestamp isn't shifted to UTC by the browser
						const timestampStr = String(ts).replace("Z", "");
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

			if (earthquakeResponse.ok) {
				const result = await earthquakeResponse.json();
				console.log("Notifications earthquake result:", result);
				if (result.dataset && result.dataset.length > 0) {
					const events = groupIntoEvents(result.dataset);

					// Sort most recent first
					events.sort((a, b) => b.start.getTime() - a.start.getTime());

					earthquakeEvents = events.map((event) => {
						// Determine intensity based on peak RMS thresholds
						let intensity = "Weak";
						if (event.peakRms >= settings.strongEarthquakeThreshold) {
							intensity = "Strong";
						} else if (event.peakRms >= settings.weakEarthquakeThreshold) {
							intensity = "Moderate";
						}

						return {
							time: event.start,
							endTime: event.end,
							rms: event.peakRms.toFixed(4),
							intensity,
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
		console.log("Notifications page mounted");
		fetchNotifications();
		// Refresh every 30 seconds
		const interval = setInterval(fetchNotifications, 30000);
		return () => clearInterval(interval);
	});
</script>

<div class="page-header">
	<h1>Notifications</h1>
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
							<div class="event-details">
								<span class="intensity-badge {event.intensity.toLowerCase()}">{event.intensity}</span>
								<span class="event-time">{formatDateTime(event.time)}</span>
							</div>
							<div class="metric">Peak RMS: {event.rms}g</div>
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
	</div>
{/if}

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

	.intensity-badge {
		padding: 0.3rem 0.8rem;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.9rem;
		text-transform: uppercase;
	}

	.intensity-badge.weak {
		background: rgba(76, 175, 80, 0.2);
		color: #4caf50;
	}

	.intensity-badge.moderate {
		background: rgba(255, 152, 0, 0.2);
		color: #ff9800;
	}

	.intensity-badge.strong {
		background: rgba(244, 67, 54, 0.2);
		color: #f44336;
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
