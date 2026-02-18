<script>
	import { localNow } from "$lib/config.js";
	import { getHiddenDeviceIds } from "$lib/deviceFilter.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { createEventDispatcher, onDestroy, onMount } from "svelte";

	const dispatch = createEventDispatcher();

	let earthquakeDetections = [];
	let loading = true;
	let refreshInterval;
	let historyInterval;
	export let hasEarthquakes = false;

	// Cached column/table names so we don't re-probe every poll
	let _deviceCol = null;
	let _tableName = null;

	async function resolveNames() {
		if (!_tableName) {
			_tableName = getTableName();
			console.log("RmsCard: tableName =", _tableName);
		}
		if (!_deviceCol) {
			const name = await getDeviceColumnName();
			_deviceCol = getQuotedColumn(name);
			console.log("RmsCard: deviceCol =", _deviceCol);
		}
		return { tableName: _tableName, deviceCol: _deviceCol };
	}

	function buildHiddenFilter(deviceCol) {
		const hiddenIds = getHiddenDeviceIds();
		return hiddenIds.length > 0 ? `AND ${deviceCol} NOT IN (${hiddenIds.map((id) => `'${id}'`).join(",")})` : "";
	}

	// ── Fast live check (runs every 3s) ──────────────────────────────
	// Show earthquake when any device reports quake_flag = 2.
	async function fetchLiveStatus() {
		console.log("RmsCard: fetchLiveStatus called");
		try {
			const { tableName, deviceCol } = await resolveNames();
			const hiddenFilter = buildHiddenFilter(deviceCol);
			console.log("RmsCard: hiddenFilter =", hiddenFilter);

			// Simple query: get most recent quake_flag=2 row with its actual timestamp
			const quakeQuery = `
				SELECT MAX(ts) as latest_ts, AVG(rms) as avg_rms, COUNT(*) as cnt
				FROM ${tableName}
				WHERE quake_flag = 2 AND ts > dateadd('m', -5, ${localNow()}) AND ts <= ${localNow()} ${hiddenFilter}
			`;

			console.log("RmsCard live check query:", quakeQuery);
			const res = await fetch(`/api/questdb?query=${encodeURIComponent(quakeQuery)}`);
			if (!res.ok) {
				console.error("RmsCard live check failed:", res.status);
				return;
			}
			const result = await res.json();
			console.log("RmsCard live check result:", result);

			if (!result.dataset || result.dataset.length === 0) {
				console.log("RmsCard: No dataset in live check");
				if (earthquakeDetections.length > 0 && earthquakeDetections[0].live) {
					earthquakeDetections = earthquakeDetections.slice(1);
					hasEarthquakes = earthquakeDetections.length > 0;
				}
				return;
			}

			const [dbTs, avgRms, cnt] = result.dataset[0];
			const hasQuake = cnt !== null && parseInt(cnt) > 0 && avgRms !== null;
			console.log("RmsCard: hasQuake=", hasQuake, "cnt=", cnt, "avgRms=", avgRms, "ts=", dbTs);

			if (hasQuake) {
				const rmsValue = parseFloat(avgRms);
				const settings = getSettings();
				let intensity = "Weak";
				if (rmsValue >= settings.strongEarthquakeThreshold) intensity = "Strong";
				else if (rmsValue >= settings.weakEarthquakeThreshold) intensity = "Moderate";

				// Use the actual DB timestamp (stored as local time, strip Z to avoid UTC re-interpretation)
				const eventTime = new Date(String(dbTs).replace("Z", ""));
				hasEarthquakes = true;
				const liveEvent = {
					timestamp: eventTime,
					rms: rmsValue,
					intensity,
					formattedTime: eventTime.toLocaleString("en-US", {
						month: "short",
						day: "numeric",
						hour: "numeric",
						minute: "2-digit",
						hour12: true,
					}),
					live: true,
				};

				if (earthquakeDetections.length > 0 && earthquakeDetections[0].live) {
					earthquakeDetections[0] = liveEvent;
					earthquakeDetections = earthquakeDetections;
				} else {
					earthquakeDetections = [liveEvent, ...earthquakeDetections];
				}
			} else {
				if (earthquakeDetections.length > 0 && earthquakeDetections[0].live) {
					earthquakeDetections = earthquakeDetections.slice(1);
					hasEarthquakes = earthquakeDetections.length > 0;
				}
			}
		} catch (error) {
			console.error("Error in live earthquake check:", error);
		}
	}

	// ── Historical scan (runs every 30s) ─────────────────────────────
	// Only confirmed events (quake_flag = 2) so RMS reflects real seismic data.
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

	async function fetchHistoricalEvents() {
		console.log("RmsCard: fetchHistoricalEvents called");
		try {
			const { tableName, deviceCol } = await resolveNames();
			const hiddenFilter = buildHiddenFilter(deviceCol);
			const settings = getSettings();
			console.log("RmsCard: settings =", settings);

			// Simple query: get all 5-min buckets with quake_flag = 2
			const query = `
				SELECT timestamp_floor('5m', ts) as bucket, MAX(rms) as peak_rms
				FROM ${tableName}
				WHERE quake_flag = 2 AND ts > dateadd('h', -24, ${localNow()}) AND ts <= ${localNow()} ${hiddenFilter}
				GROUP BY bucket
				ORDER BY bucket ASC
			`;

			console.log("RmsCard historical query:", query);
			const response = await fetch(`/api/questdb?query=${encodeURIComponent(query)}`);
			if (!response.ok) {
				console.error("RmsCard historical failed:", response.status);
				return;
			}

			const result = await response.json();
			console.log("RmsCard historical result:", result);
			const filteredDataset = result.dataset ? result.dataset : [];

			if (filteredDataset.length > 0) {
				const events = groupIntoEvents(filteredDataset);
				events.sort((a, b) => b.start.getTime() - a.start.getTime());

				const mapped = events.map((event) => {
					let intensity = "Weak";
					if (event.peakRms >= settings.strongEarthquakeThreshold) intensity = "Strong";
					else if (event.peakRms >= settings.weakEarthquakeThreshold) intensity = "Moderate";
					return {
						timestamp: event.start,
						rms: event.peakRms,
						intensity,
						formattedTime: event.start.toLocaleString("en-US", {
							month: "short",
							day: "numeric",
							hour: "numeric",
							minute: "2-digit",
							hour12: true,
						}),
						live: false,
					};
				});

				const liveEntry = earthquakeDetections.length > 0 && earthquakeDetections[0].live ? earthquakeDetections[0] : null;
				earthquakeDetections = liveEntry ? [liveEntry, ...mapped] : mapped;
				hasEarthquakes = earthquakeDetections.length > 0;
			} else {
				const liveEntry = earthquakeDetections.length > 0 && earthquakeDetections[0].live ? earthquakeDetections[0] : null;
				earthquakeDetections = liveEntry ? [liveEntry] : [];
				hasEarthquakes = earthquakeDetections.length > 0;
			}
		} catch (error) {
			console.error("Error fetching historical earthquake events:", error);
		} finally {
			loading = false;
		}
	}

	function getSettings() {
		const savedSettings = localStorage.getItem("enviroSyncSettings");
		return savedSettings ? JSON.parse(savedSettings) : { weakEarthquakeThreshold: 0.01, strongEarthquakeThreshold: 0.1 };
	}

	onMount(() => {
		console.log("RmsCard mounted - starting earthquake detection");
		// Initial load: fast live check + full history
		fetchLiveStatus();
		fetchHistoricalEvents();

		// Fast poll: lightweight live status every 3 seconds
		refreshInterval = setInterval(fetchLiveStatus, 3000);
		// Slow poll: full 24h history scan every 30 seconds
		historyInterval = setInterval(fetchHistoricalEvents, 30000);
	});

	onDestroy(() => {
		if (refreshInterval) clearInterval(refreshInterval);
		if (historyInterval) clearInterval(historyInterval);
	});
</script>

<div class="earthquake-card">
	<div class="device-header">
		<h3>Earthquake Detection</h3>
	</div>

	{#if loading}
		<div class="loading">Loading...</div>
	{:else if earthquakeDetections.length === 0}
		<div class="metric-value earthquake">No earthquakes detected</div>
	{:else}
		<div class="detections-list">
			{#each earthquakeDetections.slice(0, 1) as detection}
				<div class="detection-item {detection.intensity.toLowerCase()}">
					<span class="intensity-badge {detection.intensity.toLowerCase()}">{detection.intensity}</span>
					<div class="detection-time">{detection.formattedTime}</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.earthquake-card {
		background: #2d2d2d;
		border: 1px solid #404040;
		border-radius: 12px;
		padding: 2.5rem;
		width: 100%;
		text-align: center;
		color: inherit;
		font-family: inherit;
		transition: all 0.3s ease;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-height: 200px;
		justify-content: center;
	}

	.device-header h3 {
		font-size: 1.8rem;
		font-weight: 600;
		margin: 0;
		color: #fff;
		text-align: center;
	}

	.loading {
		font-size: 1.2rem;
		color: #888;
		text-align: center;
	}

	.metric-value {
		font-size: 1.2rem;
		font-weight: bold;
		color: #fff;
		text-align: center;
	}

	.metric-value.earthquake {
		color: #9c27b0;
	}

	.detections-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-height: 280px;
		overflow-y: auto;
	}

	.detection-item {
		background: rgba(0, 0, 0, 0.3);
		border-radius: 8px;
		padding: 1rem;
		border-left: 4px solid;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.detection-item.weak {
		border-left-color: #4caf50;
	}

	.detection-item.moderate {
		border-left-color: #ff9800;
	}

	.detection-item.strong {
		border-left-color: #f44336;
	}

	.intensity-badge {
		padding: 0.4rem 1rem;
		border-radius: 12px;
		font-size: 1rem;
		font-weight: 600;
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

	.detection-time {
		font-size: 0.9rem;
		color: #b0b0b0;
	}

	/* Custom scrollbar for detections list */
	.detections-list::-webkit-scrollbar {
		width: 6px;
	}

	.detections-list::-webkit-scrollbar-track {
		background: rgba(0, 0, 0, 0.2);
		border-radius: 3px;
	}

	.detections-list::-webkit-scrollbar-thumb {
		background: rgba(156, 39, 176, 0.5);
		border-radius: 3px;
	}

	.detections-list::-webkit-scrollbar-thumb:hover {
		background: rgba(156, 39, 176, 0.7);
	}
</style>
