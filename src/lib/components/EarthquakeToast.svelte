<script>
	import { localNow } from "$lib/config.js";
	import { getHiddenDeviceIds } from "$lib/deviceFilter.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { onDestroy, onMount } from "svelte";

	let hasEarthquake = false;
	let earthquakeIntensity = ""; // "weak" or "strong"
	let earthquakeTime = "";
	let hovered = false;
	let refreshInterval;
	let alwaysShow = false;

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
				earthquakeTime = eventTime.toLocaleString("en-US", {
					month: "short",
					day: "numeric",
					hour: "numeric",
					minute: "2-digit",
					hour12: true,
				});
			} else {
				hasEarthquake = false;
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

{#if hasEarthquake}
	<div class="earthquake-toast {earthquakeIntensity}" on:mouseenter={() => (hovered = true)} on:mouseleave={() => (hovered = false)} role="status">
		<div class="toast-content">
			<span class="toast-text">Earthquake detected</span>
			{#if hovered}
				<div class="toast-details">
					<span class="toast-detail-time">{earthquakeTime}</span>
					<span class="toast-detail-intensity">{earthquakeIntensity === "strong" ? "Strong" : "Weak"}</span>
				</div>
			{/if}
		</div>
	</div>
{:else if alwaysShow}
	<div class="earthquake-toast normal" role="status">
		<div class="toast-content">
			<span class="toast-text">Seismic: Normal</span>
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
