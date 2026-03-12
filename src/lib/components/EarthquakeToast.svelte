<script>
	import { localNow } from "$lib/config.js";
	import { getHiddenDeviceIds } from "$lib/deviceFilter.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { sidebarCollapsed } from "$lib/stores.js";
	import { onDestroy, onMount } from "svelte";

	let hasEarthquake = false;
	let earthquakeIntensity = ""; // "weak" or "strong"
	let earthquakeTime = "";
	let hovered = false;
	let refreshInterval;
	let alwaysShow = false;
	let dismissed = false;
	let dismissedEventTs = null; // Track which event was dismissed
	let currentEventTs = null; // Track current earthquake timestamp

	let _deviceCol = null;
	let _tableName = null;

	async function resolveNames() {
		if (!_tableName) _tableName = getTableName();
		if (!_deviceCol) {
			const name = await getDeviceColumnName();
			_deviceCol = getQuotedColumn(name);
		}
		return { tableName: _tableName, deviceCol: _deviceCol };
	}

	function buildHiddenFilter(deviceCol) {
		const hiddenIds = getHiddenDeviceIds();
		return hiddenIds.length > 0 ? `AND ${deviceCol} NOT IN (${hiddenIds.map((id) => `'${id}'`).join(",")})` : "";
	}

	function getSettings() {
		const savedSettings = localStorage.getItem("enviroSyncSettings");
		return savedSettings ? JSON.parse(savedSettings) : { weakEarthquakeThreshold: 0.01, strongEarthquakeThreshold: 0.1, alwaysShowToast: false };
	}

	function dismissToast() {
		dismissed = true;
		dismissedEventTs = currentEventTs;
	}

	async function checkEarthquake() {
		try {
			const settings = getSettings();
			alwaysShow = !!settings.alwaysShowToast;

			const { tableName, deviceCol } = await resolveNames();
			const hiddenFilter = buildHiddenFilter(deviceCol);

			// Check for earthquakes in last 24 hours from non-hidden devices
			const query = `
				SELECT MAX(ts) as latest_ts, MAX(rms) as peak_rms, COUNT(*) as cnt
				FROM ${tableName}
				WHERE quake_flag = 2
				AND ts > dateadd('h', -24, ${localNow()})
				${hiddenFilter}
			`;

			const res = await fetch(`/api/questdb?query=${encodeURIComponent(query)}`);
			if (!res.ok) return;

			const result = await res.json();
			if (!result.dataset || result.dataset.length === 0) {
				hasEarthquake = false;
				return;
			}

			const [dbTs, peakRms, cnt] = result.dataset[0];
			const hasQuake = cnt !== null && parseInt(cnt) > 0 && peakRms !== null;

			if (hasQuake) {
				const rmsValue = parseFloat(peakRms);
				hasEarthquake = true;
				earthquakeIntensity = rmsValue >= settings.strongEarthquakeThreshold ? "strong" : "weak";

				const eventTime = new Date(String(dbTs).replace("Z", ""));
				const eventTsStr = eventTime.toISOString();
				currentEventTs = eventTsStr;

				// If this is a new event (different from the one we dismissed), show it again
				if (dismissed && dismissedEventTs !== eventTsStr) {
					dismissed = false;
					dismissedEventTs = null;
				}

				earthquakeTime = eventTime.toLocaleString("en-US", {
					month: "short",
					day: "numeric",
					hour: "numeric",
					minute: "2-digit",
					hour12: true,
				});
			} else {
				hasEarthquake = false;
				currentEventTs = null;
				dismissed = false;
				dismissedEventTs = null;
			}
		} catch (error) {
			console.error("EarthquakeToast: Error checking earthquake:", error);
		}
	}

	onMount(() => {
		checkEarthquake();
		refreshInterval = setInterval(checkEarthquake, 5000);
	});

	onDestroy(() => {
		if (refreshInterval) clearInterval(refreshInterval);
	});
</script>

{#if hasEarthquake && (!dismissed || alwaysShow)}
	<div class="earthquake-toast {earthquakeIntensity}" class:collapsed-toast={$sidebarCollapsed} on:mouseenter={() => (hovered = true)} on:mouseleave={() => (hovered = false)} role="status">
		{#if !alwaysShow && hovered && !$sidebarCollapsed}
			<button class="dismiss-btn" on:click|stopPropagation={dismissToast} title="Dismiss">
				<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
					<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
				</svg>
			</button>
		{/if}
		<div class="toast-content">
			<svg class="toast-icon" viewBox="0 0 24 24" fill="currentColor">
				<path d="M11.5 2L6 7.5l3.5 3.5L6 15l6 7 1.5-1.5L9.5 15l3.5-4.5L9.5 7l4-3.5z" />
				<path d="M16.5 2L14 4.5 17.5 8 14 12.5l4 5.5 2-1.5-3.5-5L20 8l-3.5-6z" opacity="0.7" />
			</svg>
			{#if !$sidebarCollapsed}
				<span class="toast-text">Earthquake detected</span>
				{#if hovered}
					<div class="toast-details">
						<span class="toast-detail-time">{earthquakeTime}</span>
						<span class="toast-detail-intensity">{earthquakeIntensity === "strong" ? "Strong" : "Weak"}</span>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{:else if alwaysShow && !hasEarthquake}
	<div class="earthquake-toast normal" class:collapsed-toast={$sidebarCollapsed} role="status">
		<div class="toast-content">
			<svg class="toast-icon" viewBox="0 0 24 24" fill="currentColor">
				<path d="M11.5 2L6 7.5l3.5 3.5L6 15l6 7 1.5-1.5L9.5 15l3.5-4.5L9.5 7l4-3.5z" />
				<path d="M16.5 2L14 4.5 17.5 8 14 12.5l4 5.5 2-1.5-3.5-5L20 8l-3.5-6z" opacity="0.7" />
			</svg>
			{#if !$sidebarCollapsed}
				<span class="toast-text">Seismic: Normal</span>
			{/if}
		</div>
	</div>
{/if}

<style>
	.earthquake-toast {
		margin: 0 0.75rem;
		padding: 0.6rem 1rem;
		border-radius: 8px;
		cursor: default;
		transition: all 0.3s ease;
		animation: toastSlideUp 0.4s ease;
		position: relative;
	}

	.earthquake-toast.collapsed-toast {
		margin: 0 0.35rem;
		padding: 0.6rem;
		display: flex;
		justify-content: center;
	}

	.earthquake-toast.weak {
		background: #ffd150;
		color: #1a1a1a;
	}

	.earthquake-toast.strong {
		background: #8a244b;
		color: #fff;
	}

	.earthquake-toast.normal {
		background: rgba(76, 175, 80, 0.15);
		border: 1px solid rgba(76, 175, 80, 0.3);
		color: #4caf50;
	}

	.toast-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
	}

	.toast-icon {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.toast-text {
		font-size: 0.8rem;
		font-weight: 600;
		text-align: center;
	}

	.toast-details {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		animation: detailsFade 0.2s ease;
	}

	.toast-detail-time {
		font-size: 0.7rem;
		opacity: 0.85;
	}

	.toast-detail-intensity {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.dismiss-btn {
		position: absolute;
		top: 4px;
		right: 4px;
		background: rgba(0, 0, 0, 0.2);
		border: none;
		border-radius: 50%;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
		color: inherit;
		opacity: 0.7;
		transition:
			opacity 0.2s,
			background 0.2s;
	}

	.dismiss-btn:hover {
		opacity: 1;
		background: rgba(0, 0, 0, 0.35);
	}

	.dismiss-btn svg {
		width: 12px;
		height: 12px;
	}

	@keyframes toastSlideUp {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes detailsFade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
