<script>
	import { goto } from "$app/navigation";
	import { getHiddenDeviceIds, setHiddenDeviceIds } from "$lib/deviceFilter.js";
	import { magnitudeToRms, rmsToMagTable, rmsToMagnitude } from "$lib/magnitude.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { darkMode, magnitudeMode as magnitudeModeStore } from "$lib/stores.js";
	import { onMount } from "svelte";

	// Default thresholds
	let tempNormalMin = 18;
	let tempNormalMax = 35;
	let tempSevere = 40;

	let humidNormalMin = 30;
	let humidNormalMax = 80;
	let humidSevere = 90;

	let rmsEarthquakeThreshold = 0.05;
	let weakEarthquakeThreshold = 0.01;
	let strongEarthquakeThreshold = 0.1;
	let saveSuccess = false;
	let saveError = "";

	// Magnitude conversion toggle
	let magnitudeMode = false;

	// Dark mode toggle
	let darkModeEnabled = false;

	// Computed magnitude values
	$: generalMag = rmsToMagnitude(rmsEarthquakeThreshold).toFixed(1);
	$: weakMag = rmsToMagnitude(weakEarthquakeThreshold).toFixed(1);
	$: strongMag = rmsToMagnitude(strongEarthquakeThreshold).toFixed(1);

	function handleMagInput(field, event) {
		const mag = parseFloat(event.target.value);
		if (isNaN(mag)) return;
		const rms = magnitudeToRms(mag);
		if (field === "general") rmsEarthquakeThreshold = parseFloat(rms.toFixed(4));
		else if (field === "weak") weakEarthquakeThreshold = parseFloat(rms.toFixed(4));
		else if (field === "strong") strongEarthquakeThreshold = parseFloat(rms.toFixed(4));
	}

	// Device visibility
	let allDevices = [];
	let hiddenDevices = [];
	let loadingDevices = true;
	let animatingDeviceId = null;

	// User management
	let users = [];
	let loadingUsers = true;
	let newUsername = "";
	let newPassword = "";
	let userError = "";
	let userSuccess = "";
	let changingPasswordForUser = null;
	let newPasswordForChange = "";
	let confirmDeleteUser = null;

	// Database configuration
	let dbConfigOpen = false;
	let dbOperationLoading = false;
	let dbOperationSuccess = "";
	let dbOperationError = "";

	// Confirmation dialogs
	let showDeleteDeviceDialog = false;
	let deleteDeviceTarget = null;
	let showResetEarthquakeDialog = false;
	let showResetSevereDialog = false;
	let showResetDatabaseDialog = false;
	let resetDatabaseConfirmText = "";

	$: resetDatabaseConfirmValid = resetDatabaseConfirmText === "YES I UNDERSTAND";

	async function fetchAllDevices() {
		try {
			loadingDevices = true;
			const deviceColName = await getDeviceColumnName();
			const deviceCol = getQuotedColumn(deviceColName);
			const tableName = getTableName();
			const query = `SELECT DISTINCT ${deviceCol} FROM ${tableName} ORDER BY ${deviceCol}`;

			const response = await fetch(`/api/questdb?query=${encodeURIComponent(query)}`);
			if (response.ok) {
				const result = await response.json();
				if (result.dataset && result.dataset.length > 0) {
					allDevices = result.dataset.map((row) => row[0]).sort();
				}
			}
		} catch (err) {
			console.error("Error fetching devices:", err);
		} finally {
			loadingDevices = false;
		}
	}

	async function toggleDeviceVisibility(deviceId) {
		animatingDeviceId = deviceId;
		const index = hiddenDevices.indexOf(deviceId);
		if (index === -1) {
			hiddenDevices = [...hiddenDevices, deviceId];
		} else {
			hiddenDevices = hiddenDevices.filter((id) => id !== deviceId);
		}
		setHiddenDeviceIds(hiddenDevices);

		// Persist to server
		try {
			await fetch("/api/device-visibility", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ hiddenDevices }),
			});
		} catch (err) {
			console.error("Error saving device visibility:", err);
		}

		setTimeout(() => {
			animatingDeviceId = null;
		}, 400);
	}

	function isDeviceHidden(deviceId) {
		return hiddenDevices.includes(deviceId);
	}

	// Load settings from server on mount, fall back to localStorage
	onMount(async () => {
		let perUserSettings = null;
		let sharedSettings = null;

		// Load per-user settings
		try {
			const res = await fetch("/api/settings");
			if (res.ok) {
				const data = await res.json();
				if (data.settings) {
					perUserSettings = data.settings;
				}
			}
		} catch {
			// Fall back to localStorage
		}

		// Load shared settings
		try {
			const res = await fetch("/api/settings?type=shared");
			if (res.ok) {
				const data = await res.json();
				if (data.settings) {
					sharedSettings = data.settings;
				}
			}
		} catch {
			// Fall back to localStorage
		}

		// Fall back to localStorage if server had no settings
		let localSettings = null;
		if (!perUserSettings && !sharedSettings) {
			const savedSettings = localStorage.getItem("enviroSyncSettings");
			if (savedSettings) {
				try {
					localSettings = JSON.parse(savedSettings);
				} catch (err) {
					console.error("Error loading settings:", err);
				}
			}
		}

		// Apply shared settings (or fall back to local)
		const shared = sharedSettings || localSettings || {};
		tempNormalMin = shared.tempNormalMin ?? 18;
		tempNormalMax = shared.tempNormalMax ?? 35;
		tempSevere = shared.tempSevere ?? 40;
		humidNormalMin = shared.humidNormalMin ?? 30;
		humidNormalMax = shared.humidNormalMax ?? 80;
		humidSevere = shared.humidSevere ?? 90;
		rmsEarthquakeThreshold = shared.rmsEarthquakeThreshold ?? 0.05;
		weakEarthquakeThreshold = shared.weakEarthquakeThreshold ?? 0.01;
		strongEarthquakeThreshold = shared.strongEarthquakeThreshold ?? 0.1;

		// Apply per-user settings (or fall back to local)
		const perUser = perUserSettings || localSettings || {};
		magnitudeMode = perUser.magnitudeMode ?? false;
		darkModeEnabled = perUser.darkMode ?? false;

		// Load hidden devices from server first, fall back to localStorage
		try {
			const res = await fetch("/api/device-visibility");
			if (res.ok) {
				const data = await res.json();
				hiddenDevices = data.hiddenDevices || [];
				setHiddenDeviceIds(hiddenDevices);
			} else {
				hiddenDevices = getHiddenDeviceIds();
			}
		} catch {
			hiddenDevices = getHiddenDeviceIds();
		}

		// Fetch all devices from database
		fetchAllDevices();

		// Fetch users
		fetchUsers();
	});

	// User management functions
	async function fetchUsers() {
		try {
			loadingUsers = true;
			const response = await fetch("/api/auth/users");
			if (response.ok) {
				const data = await response.json();
				users = data.users || [];
			}
		} catch (err) {
			console.error("Error fetching users:", err);
		} finally {
			loadingUsers = false;
		}
	}

	async function createUser() {
		userError = "";
		userSuccess = "";
		if (!newUsername || !newPassword) {
			userError = "Username and password are required";
			return;
		}
		try {
			const response = await fetch("/api/auth/users", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: newUsername, password: newPassword }),
			});
			const data = await response.json();
			if (response.ok) {
				userSuccess = `User "${newUsername}" created successfully`;
				newUsername = "";
				newPassword = "";
				await fetchUsers();
				setTimeout(() => {
					userSuccess = "";
				}, 3000);
			} else {
				userError = data.error || "Failed to create user";
			}
		} catch (err) {
			userError = "Connection error";
		}
	}

	async function changePassword(userId) {
		userError = "";
		userSuccess = "";
		if (!newPasswordForChange) {
			userError = "New password is required";
			return;
		}
		try {
			const response = await fetch("/api/auth/users", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userId, newPassword: newPasswordForChange }),
			});
			const data = await response.json();
			if (response.ok) {
				userSuccess = "Password changed successfully";
				changingPasswordForUser = null;
				newPasswordForChange = "";
				setTimeout(() => {
					userSuccess = "";
				}, 3000);
			} else {
				userError = data.error || "Failed to change password";
			}
		} catch (err) {
			userError = "Connection error";
		}
	}

	async function deleteUser(userId) {
		userError = "";
		userSuccess = "";
		try {
			const response = await fetch(`/api/auth/users?userId=${userId}`, {
				method: "DELETE",
			});
			const data = await response.json();
			if (response.ok) {
				userSuccess = "User deleted successfully";
				confirmDeleteUser = null;
				await fetchUsers();
				setTimeout(() => {
					userSuccess = "";
				}, 3000);
			} else {
				userError = data.error || "Failed to delete user";
			}
		} catch (err) {
			userError = "Connection error";
		}
	}

	// Database operations
	async function confirmDeleteDevice() {
		if (!deleteDeviceTarget) return;
		dbOperationLoading = true;
		dbOperationError = "";
		dbOperationSuccess = "";
		try {
			const response = await fetch("/api/db-operations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "delete-device", deviceId: deleteDeviceTarget }),
			});
			const data = await response.json();
			if (response.ok) {
				dbOperationSuccess = `Device "${deleteDeviceTarget}" deleted successfully`;
				allDevices = allDevices.filter((d) => d !== deleteDeviceTarget);
				setTimeout(() => {
					dbOperationSuccess = "";
				}, 3000);
			} else {
				dbOperationError = data.error || "Failed to delete device";
			}
		} catch (err) {
			dbOperationError = "Connection error";
		} finally {
			dbOperationLoading = false;
			showDeleteDeviceDialog = false;
			deleteDeviceTarget = null;
		}
	}

	async function confirmResetEarthquake() {
		dbOperationLoading = true;
		dbOperationError = "";
		dbOperationSuccess = "";
		try {
			const response = await fetch("/api/db-operations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "reset-earthquake", thresholds: { rmsEarthquakeThreshold } }),
			});
			const data = await response.json();
			if (response.ok) {
				dbOperationSuccess = "Earthquake data reset successfully";
				setTimeout(() => {
					dbOperationSuccess = "";
				}, 3000);
			} else {
				dbOperationError = data.error || "Failed to reset earthquake data";
			}
		} catch (err) {
			dbOperationError = "Connection error";
		} finally {
			dbOperationLoading = false;
			showResetEarthquakeDialog = false;
		}
	}

	async function confirmResetSevere() {
		dbOperationLoading = true;
		dbOperationError = "";
		dbOperationSuccess = "";
		try {
			const response = await fetch("/api/db-operations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "reset-severe", thresholds: { tempSevere, humidSevere } }),
			});
			const data = await response.json();
			if (response.ok) {
				dbOperationSuccess = "Severe conditions data reset successfully";
				setTimeout(() => {
					dbOperationSuccess = "";
				}, 3000);
			} else {
				dbOperationError = data.error || "Failed to reset severe conditions data";
			}
		} catch (err) {
			dbOperationError = "Connection error";
		} finally {
			dbOperationLoading = false;
			showResetSevereDialog = false;
		}
	}

	async function confirmResetDatabase() {
		if (!resetDatabaseConfirmValid) return;
		dbOperationLoading = true;
		dbOperationError = "";
		dbOperationSuccess = "";
		try {
			const response = await fetch("/api/db-operations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "reset-database" }),
			});
			const data = await response.json();
			if (response.ok) {
				dbOperationSuccess = "Database reset successfully";
				allDevices = [];
				setTimeout(() => {
					dbOperationSuccess = "";
				}, 3000);
			} else {
				dbOperationError = data.error || "Failed to reset database";
			}
		} catch (err) {
			dbOperationError = "Connection error";
		} finally {
			dbOperationLoading = false;
			showResetDatabaseDialog = false;
			resetDatabaseConfirmText = "";
		}
	}

	async function saveSettings() {
		try {
			// Validate inputs
			if (tempNormalMin < 0 || tempNormalMin >= tempNormalMax) {
				saveError = "Temperature normal min must be 0 to normal max - 1";
				return;
			}
			if (tempNormalMax >= tempSevere) {
				saveError = "Temperature normal max must be less than severe threshold";
				return;
			}
			if (humidNormalMin < 0 || humidNormalMin >= humidNormalMax) {
				saveError = "Humidity normal min must be 0 to normal max - 1";
				return;
			}
			if (humidNormalMax >= humidSevere) {
				saveError = "Humidity normal max must be less than severe threshold";
				return;
			}
			if (rmsEarthquakeThreshold <= 0) {
				saveError = "RMS threshold must be greater than 0";
				return;
			}
			if (weakEarthquakeThreshold <= 0 || weakEarthquakeThreshold >= strongEarthquakeThreshold) {
				saveError = "Weak earthquake threshold must be greater than 0 and less than strong threshold";
				return;
			}
			if (strongEarthquakeThreshold <= weakEarthquakeThreshold) {
				saveError = "Strong earthquake threshold must be greater than weak threshold";
				return;
			}

			// Per-user settings
			const perUserSettings = {
				magnitudeMode,
				darkMode: darkModeEnabled,
			};

			// Shared settings
			const sharedSettings = {
				tempNormalMin,
				tempNormalMax,
				tempSevere,
				humidNormalMin,
				humidNormalMax,
				humidSevere,
				rmsEarthquakeThreshold,
				weakEarthquakeThreshold,
				strongEarthquakeThreshold,
			};

			// Merged settings for localStorage backwards compatibility
			const mergedSettings = { ...sharedSettings, ...perUserSettings };
			localStorage.setItem("enviroSyncSettings", JSON.stringify(mergedSettings));

			// Update the in-memory stores so other components reflect the change immediately
			magnitudeModeStore.set(magnitudeMode);
			darkMode.set(darkModeEnabled);

			// Save per-user settings to server
			try {
				await fetch("/api/settings", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ settings: perUserSettings }),
				});
			} catch (serverErr) {
				console.error("Failed to save per-user settings to server:", serverErr);
			}

			// Save shared settings to server
			try {
				await fetch("/api/settings", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ settings: sharedSettings, type: "shared" }),
				});
			} catch (serverErr) {
				console.error("Failed to save shared settings to server:", serverErr);
			}

			saveSuccess = true;
			saveError = "";

			// Redirect to dashboard after 1 second
			setTimeout(() => {
				goto("/");
			}, 1000);
		} catch (err) {
			saveError = "Failed to save settings: " + err.message;
			saveSuccess = false;
		}
	}

	function resetToDefaults() {
		tempNormalMin = 18;
		tempNormalMax = 35;
		tempSevere = 40;
		humidNormalMin = 30;
		humidNormalMax = 80;
		humidSevere = 90;
		rmsEarthquakeThreshold = 0.05;
		weakEarthquakeThreshold = 0.01;
		strongEarthquakeThreshold = 0.1;
	}
</script>

<div class="settings-container">
	<!-- Temperature Settings -->
	<div class="setting-section">
		<h2>
			<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
				<path d="M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4zm-4-2V5c0-.55.45-1 1-1s1 .45 1 1v6h-2z" />
			</svg>
			Temperature Thresholds (&deg;C)
		</h2>
		<div class="settings-grid">
			<div class="setting-item">
				<label for="tempNormalMin">Normal Range - Minimum</label>
				<input type="number" id="tempNormalMin" bind:value={tempNormalMin} step="0.1" />
			</div>
			<div class="setting-item">
				<label for="tempNormalMax">Normal Range - Maximum</label>
				<input type="number" id="tempNormalMax" bind:value={tempNormalMax} step="0.1" />
			</div>
			<div class="setting-item">
				<label for="tempSevere">Severe Threshold</label>
				<input type="number" id="tempSevere" bind:value={tempSevere} step="0.1" />
				<small>Values above this will trigger severe alerts</small>
			</div>
		</div>
	</div>

	<!-- Humidity Settings -->
	<div class="setting-section">
		<h2>
			<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
				<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
			</svg>
			Humidity Thresholds (%)
		</h2>
		<div class="settings-grid">
			<div class="setting-item">
				<label for="humidNormalMin">Normal Range - Minimum</label>
				<input type="number" id="humidNormalMin" bind:value={humidNormalMin} step="1" />
			</div>
			<div class="setting-item">
				<label for="humidNormalMax">Normal Range - Maximum</label>
				<input type="number" id="humidNormalMax" bind:value={humidNormalMax} step="1" />
			</div>
			<div class="setting-item">
				<label for="humidSevere">Severe Threshold</label>
				<input type="number" id="humidSevere" bind:value={humidSevere} step="1" />
				<small>Values above this will trigger severe alerts</small>
			</div>
		</div>
	</div>

	<!-- RMS Earthquake Detection -->
	<div class="setting-section">
		<h2>
			<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
				<path d="M15.54 5.54L13.77 7.3 12 5.54 10.23 7.3 8.46 5.54 12 2zm5.23 5.23l-1.77-1.77L15.54 12l3.46 3.46 1.77-1.77-3.46-3.46zM8.46 18.46L12 22l3.54-3.54L13.77 16.7 12 18.46l-1.77-1.76zm-5.23-5.23L1.46 12l1.77 1.77L6.69 10.23 3.23 13.23z" />
			</svg>
			Earthquake Detection Thresholds
		</h2>

		<div class="toggle-setting" style="margin-bottom: 1.5rem; margin-top: 0;">
			<div class="toggle-info">
				<label for="magnitudeMode">Magnitude Conversion</label>
				<small>Show thresholds as estimated Magnitude instead of RMS (g)</small>
			</div>
			<label class="toggle-switch">
				<input type="checkbox" id="magnitudeMode" bind:checked={magnitudeMode} />
				<span class="toggle-slider"></span>
			</label>
		</div>

		{#if !magnitudeMode}
			<div class="settings-grid">
				<div class="setting-item">
					<label for="rmsThreshold">General Detection Threshold (g)</label>
					<input type="number" id="rmsThreshold" bind:value={rmsEarthquakeThreshold} step="0.001" min="0.001" />
				</div>
				<div class="setting-item">
					<label for="weakThreshold">Weak Earthquake Threshold (g)</label>
					<input type="number" id="weakThreshold" bind:value={weakEarthquakeThreshold} step="0.001" min="0.001" />
				</div>
				<div class="setting-item">
					<label for="strongThreshold">Strong Earthquake Threshold (g)</label>
					<input type="number" id="strongThreshold" bind:value={strongEarthquakeThreshold} step="0.001" min="0.001" />
				</div>
			</div>
			<div class="info-box">
				<p><strong>RMS to Magnitude Conversion Guide:</strong></p>
				<div class="magnitude-table">
					<div class="table-header">
						<span>RMS (g)</span>
						<span>Display Magnitude</span>
					</div>
					<div class="table-row">
						<span>0.003</span>
						<span>1.1</span>
					</div>
					<div class="table-row">
						<span>0.01</span>
						<span>2.1</span>
					</div>
					<div class="table-row">
						<span>0.03</span>
						<span>3.2</span>
					</div>
					<div class="table-row">
						<span>0.1</span>
						<span>4.4</span>
					</div>
					<div class="table-row">
						<span>0.3</span>
						<span>5.5</span>
					</div>
					<div class="table-row">
						<span>0.7</span>
						<span>6.4</span>
					</div>
				</div>
				<p style="margin-top: 0.75rem; font-size: 0.9rem;"><strong>Note:</strong> Earthquakes below weak threshold are minor vibrations, between weak and strong are moderate, and above strong are significant seismic events.</p>
			</div>
		{:else}
			<div class="settings-grid">
				<div class="setting-item">
					<label for="rmsThresholdMag">General Detection Threshold (Magnitude)</label>
					<input type="number" id="rmsThresholdMag" value={generalMag} on:input={(e) => handleMagInput("general", e)} step="0.1" min="0" />
					<small>Minimum magnitude to trigger detection (RMS: {rmsEarthquakeThreshold.toFixed(4)}g)</small>
				</div>
				<div class="setting-item">
					<label for="weakThresholdMag">Weak Earthquake Threshold (Magnitude)</label>
					<input type="number" id="weakThresholdMag" value={weakMag} on:input={(e) => handleMagInput("weak", e)} step="0.1" min="0" />
					<small>Below this is considered weak (RMS: {weakEarthquakeThreshold.toFixed(4)}g)</small>
				</div>
				<div class="setting-item">
					<label for="strongThresholdMag">Strong Earthquake Threshold (Magnitude)</label>
					<input type="number" id="strongThresholdMag" value={strongMag} on:input={(e) => handleMagInput("strong", e)} step="0.1" min="0" />
					<small>Above this is considered strong (RMS: {strongEarthquakeThreshold.toFixed(4)}g)</small>
				</div>
			</div>
			<div class="info-box">
				<p><strong>RMS to Magnitude Reference:</strong></p>
				<div class="magnitude-table">
					<div class="table-header">
						<span>RMS (g)</span>
						<span>Magnitude</span>
					</div>
					{#each rmsToMagTable as [rms, mag]}
						<div class="table-row">
							<span>{rms}</span>
							<span>{mag}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- Device Visibility -->
	<div class="setting-section">
		<h2>
			<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
				<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
			</svg>
			Device Visibility
		</h2>

		{#if loadingDevices}
			<div class="loading-devices">
				<div class="spinner-small"></div>
				<span>Loading devices...</span>
			</div>
		{:else if allDevices.length === 0}
			<div class="no-devices">No devices found in the database</div>
		{:else}
			<div class="devices-grid">
				{#each allDevices as deviceId}
					<div class="device-item" class:hidden={isDeviceHidden(deviceId)} class:animating={animatingDeviceId === deviceId}>
						<span class="device-name">{deviceId}</span>
						<button class="visibility-btn" class:hidden={isDeviceHidden(deviceId)} on:click={() => toggleDeviceVisibility(deviceId)}>
							{#if isDeviceHidden(deviceId)}
								<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor">
									<path
										d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
									/>
								</svg>
								Show
							{:else}
								<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor">
									<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
								</svg>
								Hide
							{/if}
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Dark Mode -->
	<div class="setting-section">
		<h2>
			<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
				<path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z" />
			</svg>
			Dark Mode
		</h2>
		<div class="toggle-setting" style="margin-top: 0;">
			<div class="toggle-info">
				<label for="darkModeToggle">Enable Dark Mode</label>
				<small>Switch between light and dark theme for the application</small>
			</div>
			<label class="toggle-switch">
				<input type="checkbox" id="darkModeToggle" bind:checked={darkModeEnabled} />
				<span class="toggle-slider"></span>
			</label>
		</div>
	</div>

	<!-- User Management -->
	<div class="setting-section">
		<h2>
			<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
				<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
			</svg>
			Users
		</h2>

		{#if userError}
			<div class="alert error" style="margin-bottom: 1rem;">{userError}</div>
		{/if}
		{#if userSuccess}
			<div class="alert success" style="margin-bottom: 1rem;">{userSuccess}</div>
		{/if}

		<!-- Create User -->
		<div class="create-user-form">
			<div class="form-row">
				<input type="text" placeholder="Username" bind:value={newUsername} class="user-input" />
				<input type="password" placeholder="Password" bind:value={newPassword} class="user-input" />
				<button class="btn-create-user" on:click={createUser}>Create User</button>
			</div>
		</div>

		<!-- Users List -->
		{#if loadingUsers}
			<div class="loading-devices">
				<div class="spinner-small"></div>
				<span>Loading users...</span>
			</div>
		{:else if users.length === 0}
			<div class="no-devices">No users found</div>
		{:else}
			<div class="users-list">
				{#each users as user}
					<div class="user-item">
						<div class="user-info-row">
							<div class="user-details">
								<span class="user-name">{user.username}</span>
								<span class="user-date">Created: {new Date(user.created_at).toLocaleDateString()}</span>
							</div>
							<div class="user-actions">
								{#if changingPasswordForUser === user.id}
									<div class="change-password-inline">
										<input type="password" placeholder="New password" bind:value={newPasswordForChange} class="user-input small" />
										<button class="btn-small confirm" on:click={() => changePassword(user.id)}>Save</button>
										<button
											class="btn-small cancel"
											on:click={() => {
												changingPasswordForUser = null;
												newPasswordForChange = "";
											}}>Cancel</button
										>
									</div>
								{:else if confirmDeleteUser === user.id}
									<span class="confirm-text">Delete this user?</span>
									<button class="btn-small danger" on:click={() => deleteUser(user.id)}>Yes, Delete</button>
									<button
										class="btn-small cancel"
										on:click={() => {
											confirmDeleteUser = null;
										}}>Cancel</button
									>
								{:else}
									<button
										class="btn-small"
										on:click={() => {
											changingPasswordForUser = user.id;
											newPasswordForChange = "";
										}}>Change Password</button
									>
									<button
										class="btn-small danger-outline"
										on:click={() => {
											confirmDeleteUser = user.id;
										}}>Delete</button
									>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Database Configuration -->
	<div class="setting-section">
		<button
			class="db-config-toggle"
			on:click={() => {
				dbConfigOpen = !dbConfigOpen;
			}}
		>
			<h2>
				<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
					<path d="M12 2C6.48 2 2 4.02 2 6.5v11C2 19.98 6.48 22 12 22s10-2.02 10-4.5v-11C22 4.02 17.52 2 12 2zm0 18c-4.42 0-8-1.79-8-3.5v-2.04c1.76 1.22 4.67 2.04 8 2.04s6.24-.82 8-2.04v2.04c0 1.71-3.58 3.5-8 3.5zm0-5c-4.42 0-8-1.79-8-3.5v-2.04c1.76 1.22 4.67 2.04 8 2.04s6.24-.82 8-2.04v2.04c0 1.71-3.58 3.5-8 3.5zm0-5C7.58 10 4 8.21 4 6.5S7.58 3 12 3s8 1.79 8 3.5S16.42 10 12 10z" />
				</svg>
				WARNING ZONE
			</h2>
			<svg class="chevron-icon" class:open={dbConfigOpen} viewBox="0 0 24 24" fill="currentColor">
				<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
			</svg>
		</button>

		{#if dbConfigOpen}
			<div class="db-config-content">
				{#if dbOperationError}
					<div class="alert error" style="margin-bottom: 1rem;">{dbOperationError}</div>
				{/if}
				{#if dbOperationSuccess}
					<div class="alert success" style="margin-bottom: 1rem;">{dbOperationSuccess}</div>
				{/if}

				<!-- DELETE DEVICE -->
				<div class="db-subsection">
					<h3>DELETE DEVICE</h3>
					{#if loadingDevices}
						<div class="loading-devices">
							<div class="spinner-small"></div>
							<span>Loading devices...</span>
						</div>
					{:else if allDevices.length === 0}
						<div class="no-devices">No devices found in the database</div>
					{:else}
						<div class="devices-grid">
							{#each allDevices as deviceId}
								<div class="device-item">
									<span class="device-name">{deviceId}</span>
									<button
										class="btn-small danger"
										on:click={() => {
											deleteDeviceTarget = deviceId;
											showDeleteDeviceDialog = true;
										}}>Delete</button
									>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- RESET EARTHQUAKE -->
				<div class="db-subsection">
					<button
						class="btn-danger-action"
						on:click={() => {
							showResetEarthquakeDialog = true;
						}}>Reset Earthquake Data</button
					>
				</div>

				<!-- RESET SEVERE CONDITIONS -->
				<div class="db-subsection">
					<button
						class="btn-danger-action"
						on:click={() => {
							showResetSevereDialog = true;
						}}>Reset Severe Conditions Data</button
					>
				</div>

				<!-- RESET DATABASE -->
				<div class="db-subsection">
					<button
						class="btn-danger-action critical"
						on:click={() => {
							showResetDatabaseDialog = true;
						}}>Reset Database</button
					>
				</div>
			</div>
		{/if}
	</div>

	<!-- Save Actions -->
	<div class="actions">
		<button class="btn-secondary" on:click={resetToDefaults}>Reset to Defaults</button>
		<button class="btn-primary" on:click={saveSettings}>Save Settings</button>
	</div>

	{#if saveSuccess}
		<div class="alert success">Settings saved successfully! Redirecting to dashboard...</div>
	{/if}

	{#if saveError}
		<div class="alert error">
			{saveError}
		</div>
	{/if}
</div>

<!-- Delete Device Confirmation Dialog -->
{#if showDeleteDeviceDialog}
	<div
		class="modal-overlay"
		on:click|self={() => {
			showDeleteDeviceDialog = false;
			deleteDeviceTarget = null;
		}}
	>
		<div class="modal-dialog">
			<h3>Delete Device</h3>
			<p>Are you sure you want to delete device {deleteDeviceTarget}? This will permanently remove all data for this device.</p>
			<div class="modal-actions">
				<button
					class="btn-small cancel"
					on:click={() => {
						showDeleteDeviceDialog = false;
						deleteDeviceTarget = null;
					}}>Cancel</button
				>
				<button class="btn-small danger" disabled={dbOperationLoading} on:click={confirmDeleteDevice}>
					{#if dbOperationLoading}Deleting...{:else}Delete{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Reset Earthquake Confirmation Dialog -->
{#if showResetEarthquakeDialog}
	<div
		class="modal-overlay"
		on:click|self={() => {
			showResetEarthquakeDialog = false;
		}}
	>
		<div class="modal-dialog">
			<h3>Reset Earthquake Data</h3>
			<p>Are you sure you want to reset earthquake data? This will remove all earthquake records that exceed the current threshold.</p>
			<div class="modal-actions">
				<button
					class="btn-small cancel"
					on:click={() => {
						showResetEarthquakeDialog = false;
					}}>Cancel</button
				>
				<button class="btn-small danger" disabled={dbOperationLoading} on:click={confirmResetEarthquake}>
					{#if dbOperationLoading}Resetting...{:else}Confirm{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Reset Severe Conditions Confirmation Dialog -->
{#if showResetSevereDialog}
	<div
		class="modal-overlay"
		on:click|self={() => {
			showResetSevereDialog = false;
		}}
	>
		<div class="modal-dialog">
			<h3>Reset Severe Conditions Data</h3>
			<p>Are you sure you want to reset severe conditions data? This will remove all records where temperature or humidity exceeded severe thresholds.</p>
			<div class="modal-actions">
				<button
					class="btn-small cancel"
					on:click={() => {
						showResetSevereDialog = false;
					}}>Cancel</button
				>
				<button class="btn-small danger" disabled={dbOperationLoading} on:click={confirmResetSevere}>
					{#if dbOperationLoading}Resetting...{:else}Confirm{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Reset Database Confirmation Dialog -->
{#if showResetDatabaseDialog}
	<div
		class="modal-overlay"
		on:click|self={() => {
			showResetDatabaseDialog = false;
			resetDatabaseConfirmText = "";
		}}
	>
		<div class="modal-dialog">
			<h3>Reset Database</h3>
			<p class="warning-text">WARNING: This action will delete ALL data in the database. This cannot be undone after it is confirmed and done.</p>
			<p>Type <strong>YES I UNDERSTAND</strong> to confirm:</p>
			<input type="text" class="confirm-input" bind:value={resetDatabaseConfirmText} placeholder="Type YES I UNDERSTAND" />
			<div class="modal-actions">
				<button
					class="btn-small cancel"
					on:click={() => {
						showResetDatabaseDialog = false;
						resetDatabaseConfirmText = "";
					}}>Cancel</button
				>
				<button class="btn-small danger" disabled={!resetDatabaseConfirmValid || dbOperationLoading} on:click={confirmResetDatabase}>
					{#if dbOperationLoading}Resetting...{:else}Confirm{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.settings-container {
		max-width: 1000px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.setting-section {
		background: var(--bg-overlay);
		border-radius: 12px;
		padding: 2rem;
		border: 1px solid var(--border-color);
	}

	.setting-section h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.4rem;
		margin-bottom: 1.5rem;
		color: var(--text-primary);
	}

	.icon {
		width: 24px;
		height: 24px;
	}

	.settings-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.setting-item {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.setting-item label {
		color: var(--text-secondary);
		font-weight: 500;
		font-size: 0.95rem;
	}

	.setting-item input {
		background: var(--bg-input);
		border: 1px solid var(--input-border);
		border-radius: 6px;
		padding: 0.75rem;
		color: var(--text-primary);
		font-size: 1rem;
		transition: all 0.2s;
	}

	.setting-item input:focus {
		outline: none;
		border-color: var(--text-primary);
		background: var(--bg-hover);
	}

	.setting-item small {
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.info-box {
		background: var(--bg-hover);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 1rem;
		margin-top: 1rem;
	}

	.info-box p {
		margin: 0 0 0.5rem 0;
		color: var(--text-primary);
	}

	.magnitude-table {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-top: 0.5rem;
		font-size: 0.9rem;
	}

	.table-header {
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 0.5rem;
		background: var(--bg-overlay);
		border-radius: 4px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.table-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 0.4rem 0.5rem;
		background: var(--bg-hover);
		border-radius: 3px;
		color: var(--text-secondary);
	}

	.table-row:hover {
		background: var(--bg-overlay);
	}

	.actions {
		display: flex;
		gap: 1rem;
		justify-content: flex-end;
		margin-top: 1rem;
	}

	.btn-primary,
	.btn-secondary {
		padding: 0.75rem 2rem;
		border-radius: 6px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		border: none;
	}

	.btn-primary {
		background: var(--text-primary);
		color: var(--bg-primary);
	}

	.btn-primary:hover {
		filter: brightness(0.9);
	}

	.btn-secondary {
		background: var(--bg-hover);
		color: var(--text-secondary);
		border: 1px solid var(--input-border);
	}

	.btn-secondary:hover {
		background: var(--bg-overlay);
		color: var(--text-primary);
	}

	.alert {
		padding: 1rem;
		border-radius: 6px;
		margin-top: 1rem;
		text-align: center;
		font-weight: 500;
	}

	.alert.success {
		background: var(--bg-hover);
		border: 1px solid var(--border-color);
		color: var(--text-primary);
	}

	.alert.error {
		background: var(--bg-hover);
		border: 1px solid var(--text-muted);
		color: var(--text-primary);
	}

	.section-description {
		color: var(--text-muted);
		font-size: 0.95rem;
		margin-bottom: 1.5rem;
	}

	.loading-devices {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		color: var(--text-muted);
	}

	.spinner-small {
		width: 20px;
		height: 20px;
		border: 2px solid var(--border-color);
		border-top: 2px solid var(--text-primary);
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

	.no-devices {
		text-align: center;
		padding: 2rem;
		color: var(--text-muted);
		font-style: italic;
	}

	.devices-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1rem;
	}

	.device-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		background: var(--bg-hover);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		transition: all 0.2s;
	}

	.device-item.hidden {
		opacity: 0.5;
		background: var(--bg-overlay);
	}

	.device-name {
		font-weight: 500;
		color: var(--text-primary);
	}

	.device-item.hidden .device-name {
		color: var(--text-muted);
		text-decoration: line-through;
	}

	.visibility-btn {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.75rem;
		border-radius: 6px;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		border: 1px solid var(--border-color);
		background: var(--bg-hover);
		color: var(--text-secondary);
	}

	.visibility-btn.hidden {
		background: var(--bg-overlay);
		color: var(--text-muted);
	}

	.visibility-btn:hover {
		transform: scale(1.05);
	}

	.btn-icon {
		width: 16px;
		height: 16px;
	}

	/* Device visibility animation */
	.device-item.animating {
		animation: togglePulse 0.4s ease;
	}

	@keyframes togglePulse {
		0% {
			transform: scale(1);
		}
		30% {
			transform: scale(0.95);
			opacity: 0.7;
		}
		60% {
			transform: scale(1.02);
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	.device-item.animating.hidden {
		animation: fadeToHidden 0.4s ease;
	}

	@keyframes fadeToHidden {
		0% {
			transform: scale(1);
			opacity: 1;
		}
		50% {
			transform: scale(0.95);
			opacity: 0.3;
		}
		100% {
			transform: scale(1);
			opacity: 0.5;
		}
	}

	/* User Management Styles */
	.create-user-form {
		margin-bottom: 1.5rem;
	}

	.form-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.user-input {
		background: var(--bg-input);
		border: 1px solid var(--input-border);
		border-radius: 6px;
		padding: 0.65rem 0.75rem;
		color: var(--text-primary);
		font-size: 0.95rem;
		transition: all 0.2s;
		flex: 1;
		min-width: 140px;
		font-family: inherit;
	}

	.user-input:focus {
		outline: none;
		border-color: var(--text-primary);
		background: var(--bg-hover);
	}

	.user-input.small {
		flex: unset;
		width: 160px;
		min-width: unset;
		padding: 0.45rem 0.6rem;
		font-size: 0.85rem;
	}

	.btn-create-user {
		background: var(--text-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: 6px;
		padding: 0.65rem 1.25rem;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		font-family: inherit;
	}

	.btn-create-user:hover {
		filter: brightness(0.9);
	}

	.users-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.user-item {
		background: var(--bg-hover);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 0.85rem 1rem;
		transition: all 0.2s;
	}

	.user-item:hover {
		background: var(--bg-overlay);
	}

	.user-info-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.user-details {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.user-name {
		font-weight: 600;
		color: var(--text-primary);
		font-size: 1rem;
	}

	.user-date {
		color: var(--text-muted);
		font-size: 0.8rem;
	}

	.user-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.change-password-inline {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.confirm-text {
		color: var(--text-primary);
		font-size: 0.85rem;
		font-weight: 500;
	}

	.btn-small {
		padding: 0.35rem 0.75rem;
		border-radius: 5px;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		border: 1px solid var(--border-color);
		background: var(--bg-hover);
		color: var(--text-secondary);
		font-family: inherit;
	}

	.btn-small:hover {
		background: var(--bg-overlay);
		border-color: var(--text-muted);
		color: var(--text-primary);
	}

	.btn-small.confirm {
		background: var(--text-primary);
		border-color: var(--text-primary);
		color: var(--bg-primary);
	}

	.btn-small.confirm:hover {
		filter: brightness(0.9);
	}

	.btn-small.cancel {
		background: var(--bg-hover);
		border-color: var(--border-color);
		color: var(--text-muted);
	}

	.btn-small.cancel:hover {
		background: var(--bg-overlay);
		color: var(--text-primary);
	}

	.btn-small.danger {
		background: var(--bg-overlay);
		border-color: var(--text-muted);
		color: var(--text-primary);
	}

	.btn-small.danger:hover {
		background: var(--bg-hover);
		border-color: var(--text-primary);
	}

	.btn-small.danger:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-small.danger-outline {
		background: transparent;
		border-color: var(--text-muted);
		color: var(--text-secondary);
	}

	.btn-small.danger-outline:hover {
		background: var(--bg-hover);
		border-color: var(--text-primary);
		color: var(--text-primary);
	}

	/* Toggle switch */
	.toggle-setting {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem;
		margin-top: 1rem;
		background: var(--bg-hover);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		gap: 1rem;
	}

	.toggle-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.toggle-info label {
		color: var(--text-primary);
		font-weight: 500;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.toggle-info small {
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.toggle-switch {
		position: relative;
		display: inline-block;
		width: 48px;
		height: 26px;
		flex-shrink: 0;
	}

	.toggle-switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-slider {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--border-color);
		transition: 0.3s;
		border-radius: 26px;
	}

	.toggle-slider:before {
		position: absolute;
		content: "";
		height: 20px;
		width: 20px;
		left: 3px;
		bottom: 3px;
		background: var(--text-primary);
		transition: 0.3s;
		border-radius: 50%;
	}

	.toggle-switch input:checked + .toggle-slider {
		background: var(--text-primary);
	}

	.toggle-switch input:checked + .toggle-slider:before {
		transform: translateX(22px);
	}

	/* Database Configuration */
	.db-config-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		color: inherit;
		font-family: inherit;
	}

	.db-config-toggle h2 {
		margin-bottom: 0;
	}

	.chevron-icon {
		width: 24px;
		height: 24px;
		color: var(--text-secondary);
		transition: transform 0.3s ease;
		flex-shrink: 0;
	}

	.chevron-icon.open {
		transform: rotate(180deg);
	}

	.db-config-content {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.db-subsection {
		background: var(--bg-hover);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 0.75rem;
	}

	.db-subsection h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 1rem;
		letter-spacing: 0.5px;
	}

	.btn-danger-action {
		background: var(--bg-overlay);
		border: 1px solid var(--text-muted);
		border-radius: 6px;
		padding: 0.65rem 1.25rem;
		color: var(--text-primary);
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}

	.btn-danger-action:hover {
		background: var(--bg-hover);
		border-color: var(--text-primary);
	}

	.btn-danger-action.critical {
		background: var(--bg-hover);
		border-color: var(--text-primary);
	}

	.btn-danger-action.critical:hover {
		background: var(--bg-overlay);
	}

	/* Modal Dialog */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
	}

	.modal-dialog {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 2rem;
		max-width: 480px;
		width: 90%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	}

	.modal-dialog h3 {
		font-size: 1.25rem;
		color: var(--text-primary);
		margin-bottom: 1rem;
	}

	.modal-dialog p {
		color: var(--text-secondary);
		font-size: 0.95rem;
		line-height: 1.5;
		margin-bottom: 1rem;
	}

	.modal-dialog .warning-text {
		color: var(--text-primary);
		font-weight: 600;
		font-size: 1rem;
	}

	.confirm-input {
		width: 100%;
		background: var(--bg-input);
		border: 1px solid var(--input-border);
		border-radius: 6px;
		padding: 0.75rem;
		color: var(--text-primary);
		font-size: 1rem;
		font-family: inherit;
		margin-bottom: 1rem;
		transition: all 0.2s;
	}

	.confirm-input:focus {
		outline: none;
		border-color: var(--text-primary);
		background: var(--bg-hover);
	}

	.modal-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
	}

	@media (max-width: 768px) {
		.settings-grid {
			grid-template-columns: 1fr;
		}

		.btn-primary,
		.btn-secondary {
			width: 100%;
		}

		.form-row {
			flex-direction: column;
		}

		.user-input,
		.user-input.small {
			width: 100%;
			min-width: unset;
		}

		.user-info-row {
			flex-direction: column;
			align-items: flex-start;
		}

		.user-actions {
			width: 100%;
		}

		.change-password-inline {
			flex-wrap: wrap;
		}

		.devices-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
