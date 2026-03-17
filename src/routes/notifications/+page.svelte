<script>
	import { localNow } from "$lib/config.js";
	import { getHiddenDeviceIds } from "$lib/deviceFilter.js";
	import { rmsToMagnitude } from "$lib/magnitude.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { magnitudeMode } from "$lib/stores.js";
	import { onMount } from "svelte";

	let tempRanges = [];
	let humidRanges = [];
	let earthquakeEvents = [];
	let loading = true;

	let showAllEarthquake = false;
	let showAllTemp = false;
	let showAllHumid = false;

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

	/**
	 * Group severe condition rows into ranges.
	 * Consecutive rows within gapMs are merged into a single range.
	 * If the latest row is within recentMs of now, the end is marked "now".
	 */
	function groupSevereIntoRanges(rows, gapMs = 10 * 60 * 1000, recentMs = 5 * 60 * 1000) {
		if (!rows || rows.length === 0) return [];

		// Sort ascending by time
		const sorted = [...rows].sort((a, b) => a.time.getTime() - b.time.getTime());

		const ranges = [];
		let cur = null;

		for (const row of sorted) {
			if (!cur || row.time.getTime() - cur.end.getTime() > gapMs || row.device !== cur.device) {
				if (cur) ranges.push(cur);
				cur = { start: row.time, end: row.time, device: row.device, peakValue: row.value };
			} else {
				cur.end = row.time;
				cur.peakValue = Math.max(cur.peakValue, row.value);
			}
		}
		if (cur) ranges.push(cur);

		const now = new Date();
		for (const range of ranges) {
			range.isOngoing = now.getTime() - range.end.getTime() < recentMs;
		}

		// Sort newest first
		ranges.sort((a, b) => b.start.getTime() - a.start.getTime());

		return ranges;
	}

	async function fetchNotifications() {
		try {
			const isInitialLoad = tempRanges.length === 0 && humidRanges.length === 0 && earthquakeEvents.length === 0;
			if (isInitialLoad) {
				loading = true;
			}
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();

			const sharedRaw = localStorage.getItem("enviroSyncSharedSettings");
			const legacyRaw = localStorage.getItem("enviroSyncSettings");
			const shared = sharedRaw ? JSON.parse(sharedRaw) : {};
			const legacy = legacyRaw ? JSON.parse(legacyRaw) : {};
			const settings = {
				tempSevere: shared.tempSevere ?? legacy.tempSevere ?? 40,
				humidSevere: shared.humidSevere ?? legacy.humidSevere ?? 90,
				weakEarthquakeThreshold: shared.weakEarthquakeThreshold ?? legacy.weakEarthquakeThreshold ?? 0.01,
				strongEarthquakeThreshold: shared.strongEarthquakeThreshold ?? legacy.strongEarthquakeThreshold ?? 0.1,
			};

			const hiddenIds = getHiddenDeviceIds();
			const hiddenFilter = hiddenIds.length > 0 ? `AND ${deviceCol} NOT IN (${hiddenIds.map((id) => `'${id}'`).join(",")})` : "";

			const tempQuery = `SELECT ts, ${deviceCol} as device, temp FROM ${tableName} WHERE temp > ${settings.tempSevere} ${hiddenFilter} AND ts > dateadd('d', -7, ${localNow()}) ORDER BY ts DESC LIMIT 200`;

			const humidQuery = `SELECT ts, ${deviceCol} as device, humid FROM ${tableName} WHERE humid > ${settings.humidSevere} ${hiddenFilter} AND ts > dateadd('d', -7, ${localNow()}) ORDER BY ts DESC LIMIT 200`;

			const earthquakeQuery = `
				SELECT timestamp_floor('5m', ts) as bucket, MAX(rms) as peak_rms
				FROM ${tableName}
				WHERE quake_flag = 2 AND rms IS NOT NULL AND ts > dateadd('d', -7, ${localNow()}) ${hiddenFilter}
				GROUP BY bucket
				ORDER BY bucket ASC
			`;

			const [tempResponse, humidResponse, earthquakeResponse] = await Promise.all([fetch(`/api/questdb?query=${encodeURIComponent(tempQuery)}`), fetch(`/api/questdb?query=${encodeURIComponent(humidQuery)}`), fetch(`/api/questdb?query=${encodeURIComponent(earthquakeQuery)}`)]);

			if (tempResponse.ok) {
				const result = await tempResponse.json();
				if (result.dataset && result.dataset.length > 0) {
					const rows = result.dataset.map(([ts, device, temp]) => ({
						time: new Date(String(ts).replace("Z", "")),
						device,
						value: parseFloat(temp),
					}));
					tempRanges = groupSevereIntoRanges(rows);
				} else {
					tempRanges = [];
				}
			} else {
				console.warn("Temp query failed with status:", tempResponse.status);
			}

			if (humidResponse.ok) {
				const result = await humidResponse.json();
				if (result.dataset && result.dataset.length > 0) {
					const rows = result.dataset.map(([ts, device, humid]) => ({
						time: new Date(String(ts).replace("Z", "")),
						device,
						value: parseFloat(humid),
					}));
					humidRanges = groupSevereIntoRanges(rows);
				} else {
					humidRanges = [];
				}
			} else {
				console.warn("Humid query failed with status:", humidResponse.status);
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

	function formatShortDateTime(date) {
		return date.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
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
		// Retry sooner if initial load fails
		const retryTimeout = setTimeout(() => {
			if (tempRanges.length === 0 && humidRanges.length === 0 && earthquakeEvents.length === 0) {
				fetchNotifications();
			}
		}, 3000);
		return () => {
			clearInterval(interval);
			clearTimeout(retryTimeout);
		};
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
		<!-- Earthquake -->
		<div class="notification-section earthquake">
			<div class="section-header">
				<h2>
					<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
						<path d="M15.54 5.54L13.77 7.3 12 5.54 10.23 7.3 8.46 5.54 12 2zm5.23 5.23l-1.77-1.77L15.54 12l3.46 3.46 1.77-1.77-3.46-3.46zM8.46 18.46L12 22l3.54-3.54L13.77 16.7 12 18.46l-1.77-1.76zm-5.23-5.23L1.46 12l1.77 1.77L6.69 10.23 3.23 13.23z" />
					</svg>
					Earthquake
				</h2>
				<span class="count">{earthquakeEvents.length}</span>
			</div>
			<div class="events-list">
				{#if earthquakeEvents.length === 0}
					<div class="no-events">No earthquake events in the last 7 days</div>
				{:else}
					{#each showAllEarthquake ? earthquakeEvents : earthquakeEvents.slice(0, 3) as event}
						<div class="event-item">
							<div class="event-details">
								<span class="intensity-badge {event.intensity.toLowerCase()}">{event.intensity}</span>
								<span class="event-time">{formatDateTime(event.time)}</span>
							</div>
							<div class="metric">Peak {$magnitudeMode ? "Magnitude" : "RMS"}: {$magnitudeMode ? rmsToMagnitude(parseFloat(event.rms)).toFixed(1) + " Mag" : event.rms + "g"}</div>
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

		<!-- Temperature -->
		<div class="notification-section temperature">
			<div class="section-header">
				<h2>
					<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
						<path d="M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4zm-4-8c0-.55.45-1 1-1s1 .45 1 1h-1v1h1v2h-1v1h1v2h-2V5z" />
					</svg>
					Temperature
				</h2>
				<span class="count">{tempRanges.length}</span>
			</div>
			<div class="events-list">
				{#if tempRanges.length === 0}
					<div class="no-events">No severe temperature in the last 7 days</div>
				{:else}
					{#each showAllTemp ? tempRanges : tempRanges.slice(0, 3) as range}
						<div class="event-item">
							<div class="event-details">
								<span class="device-badge">{range.device}</span>
								<span class="metric">Peak: {range.peakValue.toFixed(2)}°C</span>
							</div>
							<div class="event-time">
								{formatShortDateTime(range.start)} — {range.isOngoing ? "now" : formatShortDateTime(range.end)}
							</div>
							<div class="event-relative">{range.isOngoing ? "Ongoing" : formatRelativeTime(range.start)}</div>
						</div>
					{/each}
					{#if tempRanges.length > 3}
						<button class="show-more-btn" on:click={() => (showAllTemp = !showAllTemp)}>
							{showAllTemp ? "Show Less" : `Show More (${tempRanges.length - 3} more)`}
						</button>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Humidity -->
		<div class="notification-section humidity">
			<div class="section-header">
				<h2>
					<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
						<path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8zm0 18c-3.35 0-6-2.57-6-6.2 0-2.34 1.95-5.44 6-9.14 4.05 3.7 6 6.79 6 9.14 0 3.63-2.65 6.2-6 6.2z" />
					</svg>
					Humidity
				</h2>
				<span class="count">{humidRanges.length}</span>
			</div>
			<div class="events-list">
				{#if humidRanges.length === 0}
					<div class="no-events">No severe humidity in the last 7 days</div>
				{:else}
					{#each showAllHumid ? humidRanges : humidRanges.slice(0, 3) as range}
						<div class="event-item">
							<div class="event-details">
								<span class="device-badge">{range.device}</span>
								<span class="metric">Peak: {range.peakValue.toFixed(1)}%</span>
							</div>
							<div class="event-time">
								{formatShortDateTime(range.start)} — {range.isOngoing ? "now" : formatShortDateTime(range.end)}
							</div>
							<div class="event-relative">{range.isOngoing ? "Ongoing" : formatRelativeTime(range.start)}</div>
						</div>
					{/each}
					{#if humidRanges.length > 3}
						<button class="show-more-btn" on:click={() => (showAllHumid = !showAllHumid)}>
							{showAllHumid ? "Show Less" : `Show More (${humidRanges.length - 3} more)`}
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
		gap: 1.5rem;
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

	.notification-section.temperature {
		border-left-color: var(--accent-red, #e65050);
	}

	.notification-section.humidity {
		border-left-color: var(--accent-blue);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
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
		gap: 0.75rem;
	}

	.no-events {
		text-align: center;
		padding: 1.5rem;
		color: var(--text-muted);
		font-style: italic;
	}

	.event-item {
		background: var(--bg-hover);
		padding: 0.75rem 1rem;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		transition: background 0.2s;
	}

	.event-item:hover {
		background: var(--bg-overlay);
	}

	.event-time {
		font-size: 0.9rem;
		color: var(--text-secondary);
		font-weight: 500;
	}

	.event-details {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.device-badge {
		background: rgba(57, 158, 230, 0.15);
		color: var(--accent-blue);
		padding: 0.2rem 0.6rem;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.85rem;
	}

	.intensity-badge {
		padding: 0.2rem 0.6rem;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.85rem;
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
		font-size: 0.85rem;
	}

	.show-more-btn {
		width: 100%;
		padding: 0.6rem;
		background: rgba(57, 158, 230, 0.08);
		border: 1px solid rgba(57, 158, 230, 0.25);
		color: var(--accent-blue);
		border-radius: 6px;
		font-size: 0.85rem;
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
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	@media (max-width: 768px) {
		.notifications-grid {
			gap: 1rem;
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
