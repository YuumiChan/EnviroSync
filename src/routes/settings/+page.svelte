<script>
	import { goto } from "$app/navigation";
	import { getHiddenDeviceIds, setHiddenDeviceIds } from "$lib/deviceFilter.js";
	import { getDeviceColumnName, getQuotedColumn, getTableName } from "$lib/questdbHelpers.js";
	import { onMount } from "svelte";

	// Default thresholds
	let tempNormalMin = 18;
	let tempNormalMax = 35;
	let tempSevere = 40;

	let humidNormalMin = 30;
	let humidNormalMax = 80;
	let humidSevere = 90;

	let rmsEarthquakeThreshold = 0.05;
	let weakEarthquakeThreshold = 0.01; // RMS for weak earthquake (Magnitude ~2.1)
	let strongEarthquakeThreshold = 0.1; // RMS for strong earthquake (Magnitude ~4.4)

	let saveSuccess = false;
	let saveError = "";

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

	function toggleDeviceVisibility(deviceId) {
		animatingDeviceId = deviceId;
		const index = hiddenDevices.indexOf(deviceId);
		if (index === -1) {
			hiddenDevices = [...hiddenDevices, deviceId];
		} else {
			hiddenDevices = hiddenDevices.filter((id) => id !== deviceId);
		}
		setHiddenDeviceIds(hiddenDevices);
		setTimeout(() => {
			animatingDeviceId = null;
		}, 400);
	}

	function isDeviceHidden(deviceId) {
		return hiddenDevices.includes(deviceId);
	}

	// Load settings from localStorage on mount
	onMount(() => {
		const savedSettings = localStorage.getItem("enviroSyncSettings");
		if (savedSettings) {
			try {
				const settings = JSON.parse(savedSettings);
				tempNormalMin = settings.tempNormalMin ?? 18;
				tempNormalMax = settings.tempNormalMax ?? 35;
				tempSevere = settings.tempSevere ?? 40;
				humidNormalMin = settings.humidNormalMin ?? 30;
				humidNormalMax = settings.humidNormalMax ?? 80;
				humidSevere = settings.humidSevere ?? 90;
				rmsEarthquakeThreshold = settings.rmsEarthquakeThreshold ?? 0.05;
				weakEarthquakeThreshold = settings.weakEarthquakeThreshold ?? 0.01;
				strongEarthquakeThreshold = settings.strongEarthquakeThreshold ?? 0.1;
			} catch (err) {
				console.error("Error loading settings:", err);
			}
		}

		// Load hidden devices
		hiddenDevices = getHiddenDeviceIds();

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

	function saveSettings() {
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

			// Save to localStorage
			const settings = {
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

			localStorage.setItem("enviroSyncSettings", JSON.stringify(settings));

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

<div class="page-header">
	<h1>Settings</h1>
</div>

<div class="settings-container">
	<!-- Temperature Settings -->
	<div class="setting-section">
		<h2>
			<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
				<path d="M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4zm-4-2V5c0-.55.45-1 1-1s1 .45 1 1v6h-2z" />
			</svg>
			Temperature Thresholds (°C)
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
		<div class="settings-grid">
			<div class="setting-item">
				<label for="rmsThreshold">General Detection Threshold (g)</label>
				<input type="number" id="rmsThreshold" bind:value={rmsEarthquakeThreshold} step="0.001" min="0.001" />
				<small>Minimum RMS to trigger earthquake detection</small>
			</div>
			<div class="setting-item">
				<label for="weakThreshold">Weak Earthquake Threshold (g)</label>
				<input type="number" id="weakThreshold" bind:value={weakEarthquakeThreshold} step="0.001" min="0.001" />
				<small>RMS below this is considered weak (default: 0.01g ≈ Mag 2.1)</small>
			</div>
			<div class="setting-item">
				<label for="strongThreshold">Strong Earthquake Threshold (g)</label>
				<input type="number" id="strongThreshold" bind:value={strongEarthquakeThreshold} step="0.001" min="0.001" />
				<small>RMS above this is considered strong (default: 0.1g ≈ Mag 4.4)</small>
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

	<!-- User Management -->
	<div class="setting-section">
		<h2>
			<svg class="icon" viewBox="0 0 24 24" fill="currentColor">
				<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
			</svg>
			Users
		</h2>
		<p class="section-description">Manage user accounts for the system.</p>

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
								<svg class="user-icon" viewBox="0 0 24 24" fill="currentColor">
									<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
								</svg>
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

	.settings-container {
		max-width: 1000px;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.setting-section {
		background: rgba(0, 0, 0, 0.3);
		border-radius: 12px;
		padding: 2rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	.setting-section h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.4rem;
		margin-bottom: 1.5rem;
		color: #fff;
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
		color: #b0b0b0;
		font-weight: 500;
		font-size: 0.95rem;
	}

	.setting-item input {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 6px;
		padding: 0.75rem;
		color: #fff;
		font-size: 1rem;
		transition: all 0.2s;
	}

	.setting-item input:focus {
		outline: none;
		border-color: #4a90e2;
		background: rgba(255, 255, 255, 0.08);
	}

	.setting-item small {
		color: #666;
		font-size: 0.85rem;
	}

	.info-box {
		background: rgba(74, 144, 226, 0.1);
		border: 1px solid rgba(74, 144, 226, 0.3);
		border-radius: 6px;
		padding: 1rem;
		margin-top: 1rem;
	}

	.info-box p {
		margin: 0 0 0.5rem 0;
		color: #4a90e2;
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
		background: rgba(74, 144, 226, 0.2);
		border-radius: 4px;
		font-weight: 600;
		color: #4a90e2;
	}

	.table-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 0.4rem 0.5rem;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 3px;
		color: #b0b0b0;
	}

	.table-row:hover {
		background: rgba(255, 255, 255, 0.08);
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
		background: #4a90e2;
		color: white;
	}

	.btn-primary:hover {
		background: #357abd;
	}

	.btn-secondary {
		background: rgba(255, 255, 255, 0.1);
		color: #b0b0b0;
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	.btn-secondary:hover {
		background: rgba(255, 255, 255, 0.15);
		color: #fff;
	}

	.alert {
		padding: 1rem;
		border-radius: 6px;
		margin-top: 1rem;
		text-align: center;
		font-weight: 500;
	}

	.alert.success {
		background: rgba(76, 175, 80, 0.2);
		border: 1px solid #4caf50;
		color: #4caf50;
	}

	.alert.error {
		background: rgba(244, 67, 54, 0.2);
		border: 1px solid #f44336;
		color: #f44336;
	}

	.section-description {
		color: #888;
		font-size: 0.95rem;
		margin-bottom: 1.5rem;
	}

	.loading-devices {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		color: #888;
	}

	.spinner-small {
		width: 20px;
		height: 20px;
		border: 2px solid #333;
		border-top: 2px solid #4a90e2;
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
		color: #666;
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
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		transition: all 0.2s;
	}

	.device-item.hidden {
		opacity: 0.5;
		background: rgba(255, 255, 255, 0.02);
	}

	.device-name {
		font-weight: 500;
		color: #fff;
	}

	.device-item.hidden .device-name {
		color: #888;
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
		border: none;
		background: rgba(76, 175, 80, 0.2);
		color: #4caf50;
	}

	.visibility-btn.hidden {
		background: rgba(74, 144, 226, 0.2);
		color: #4a90e2;
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
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 6px;
		padding: 0.65rem 0.75rem;
		color: #fff;
		font-size: 0.95rem;
		transition: all 0.2s;
		flex: 1;
		min-width: 140px;
		font-family: inherit;
	}

	.user-input:focus {
		outline: none;
		border-color: #4a90e2;
		background: rgba(255, 255, 255, 0.08);
	}

	.user-input.small {
		flex: unset;
		width: 160px;
		min-width: unset;
		padding: 0.45rem 0.6rem;
		font-size: 0.85rem;
	}

	.btn-create-user {
		background: #4a90e2;
		color: white;
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
		background: #357abd;
	}

	.users-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.user-item {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		padding: 0.85rem 1rem;
		transition: all 0.2s;
	}

	.user-item:hover {
		background: rgba(255, 255, 255, 0.08);
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

	.user-icon {
		width: 20px;
		height: 20px;
		color: #4a90e2;
		flex-shrink: 0;
	}

	.user-name {
		font-weight: 600;
		color: #fff;
		font-size: 1rem;
	}

	.user-date {
		color: #666;
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
		color: #f44336;
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
		border: 1px solid rgba(74, 144, 226, 0.3);
		background: rgba(74, 144, 226, 0.1);
		color: #4a90e2;
		font-family: inherit;
	}

	.btn-small:hover {
		background: rgba(74, 144, 226, 0.2);
		border-color: #4a90e2;
	}

	.btn-small.confirm {
		background: rgba(76, 175, 80, 0.2);
		border-color: rgba(76, 175, 80, 0.3);
		color: #4caf50;
	}

	.btn-small.confirm:hover {
		background: rgba(76, 175, 80, 0.3);
		border-color: #4caf50;
	}

	.btn-small.cancel {
		background: rgba(255, 255, 255, 0.05);
		border-color: rgba(255, 255, 255, 0.15);
		color: #888;
	}

	.btn-small.cancel:hover {
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
	}

	.btn-small.danger {
		background: rgba(244, 67, 54, 0.2);
		border-color: rgba(244, 67, 54, 0.3);
		color: #f44336;
	}

	.btn-small.danger:hover {
		background: rgba(244, 67, 54, 0.3);
		border-color: #f44336;
	}

	.btn-small.danger-outline {
		background: transparent;
		border-color: rgba(244, 67, 54, 0.3);
		color: #f44336;
	}

	.btn-small.danger-outline:hover {
		background: rgba(244, 67, 54, 0.15);
		border-color: #f44336;
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
	}
</style>
