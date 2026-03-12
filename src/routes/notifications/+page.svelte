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

	function groupIntoEvents(dataset, gapMs = 10 * 60 * 1000) {
		if (!dataset || dataset.length === 0) return [];

		const events = [];
		let cur = null;

		for (const row of dataset) {
			const time = new Date(String(row[0]).replace("Z", ""));
			const rms = parseFloat(row[1]);
			if (isNaN(rms)) continue;

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
		try {
			const isInitialLoad = severeEvents.length === 0 && earthquakeEvents.length === 0;
			if (isInitialLoad) {
				loading = true;
			}
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();

			const savedSettings = localStorage.getItem("enviroSyncSettings");
			const settings = savedSettings
				? JSON.parse(savedSettings)
				: {
						tempSevere: 40,
						humidSevere: 90,
						weakEarthquakeThreshold: 0.01,
						strongEarthquakeThreshold: 0.1,
					};

			const hiddenIds = getHiddenDeviceIds();
			const hiddenFilter = hiddenIds.length > 0 ? `AND ${deviceCol} NOT IN (${hiddenIds.map((id) => `'${id}'`).join(",")})` : "";

			const severeQuery = `SELECT ts, ${deviceCol} as device, temp, humid FROM ${tableName} WHERE (temp > ${settings.tempSevere} OR humid > ${settings.humidSevere}) ${hiddenFilter} AND ts > dateadd('d', -7, ${localNow()}) ORDER BY ts DESC LIMIT 50`;

			const earthquakeQuery = `
				SELECT timestamp_floor('5m', ts) as bucket, MAX(rms) as peak_rms
				FROM ${tableName}
				WHERE quake_flag = 2 AND rms IS NOT NULL AND ts > dateadd('d', -7, ${localNow()}) ${hiddenFilter}
				GROUP BY bucket
				ORDER BY bucket ASC
			`;

			const [severeResponse, earthquakeResponse] = await Promise.all([fetch(`/api/questdb?query=${encodeURIComponent(severeQuery)}`), fetch(`/api/questdb?query=${encodeURIComponent(earthquakeQuery)}`)]);

			if (severeResponse.ok) {
				const result = await severeResponse.json();
				if (result.dataset && result.dataset.length > 0) {
					severeEvents = result.dataset.map(([ts, device, temp, humid]) => {
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
				if (result.dataset && result.dataset.length > 0) {
					const events = groupIntoEvents(result.dataset);

					events.sort((a, b) => b.start.getTime() - a.start.getTime());

					earthquakeEvents = events.map((event) => {
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
		fetchNotifications();
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
							<div class="metric">Peak Magnitude: {event.rms}g</div>
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
		color: var(--text-primary);
	}

	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 400px;
		gap: 1rem;
		color: var(--text-secondary);
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

	.notifications-grid {
		display: grid;
		gap: 2rem;
	}

	.notification-section {
		background: var(--bg-overlay);
		border-radius: 12px;
		padding: 1.5rem;
		border-left: 4px solid;
	}

	.notification-section.earthquake {
		border-left-color: var(--accent-purple);
	}

	.notification-section.severe {
		border-left-color: var(--accent-red, #e65050);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border-color);
	}

	.section-header h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.3rem;
		margin: 0;
		color: var(--text-primary);
	}

	.icon {
		width: 24px;
		height: 24px;
	}

	.count {
		background: var(--bg-hover);
		padding: 0.3rem 0.8rem;
		border-radius: 20px;
		font-weight: bold;
		font-size: 0.9rem;
		color: var(--text-primary);
	}

	.events-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.no-events {
		text-align: center;
		padding: 2rem;
		color: var(--text-muted);
		font-style: italic;
	}

	.event-item {
		background: var(--bg-hover);
		padding: 1rem;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition: background 0.2s;
	}

	.event-item:hover {
		background: var(--bg-overlay);
	}

	.event-time {
		font-size: 0.95rem;
		color: var(--text-secondary);
		font-weight: 500;
	}

	.event-details {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.device-badge {
		background: rgba(57, 158, 230, 0.15);
		color: var(--accent-blue);
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
		background: rgba(108, 191, 67, 0.15);
		color: var(--accent-green);
	}

	.intensity-badge.moderate {
		background: rgba(250, 141, 62, 0.15);
		color: var(--accent-orange);
	}

	.intensity-badge.strong {
		background: rgba(230, 80, 80, 0.15);
		color: var(--accent-red, #e65050);
	}

	.metric {
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.show-more-btn {
		width: 100%;
		padding: 0.75rem;
		background: rgba(57, 158, 230, 0.08);
		border: 1px solid rgba(57, 158, 230, 0.25);
		color: var(--accent-blue);
		border-radius: 6px;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}

	.show-more-btn:hover {
		background: rgba(57, 158, 230, 0.15);
		border-color: var(--accent-blue);
	}

	.event-relative {
		font-size: 0.85rem;
		color: var(--text-muted);
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
	}
</style>
