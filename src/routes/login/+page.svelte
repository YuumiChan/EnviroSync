<script>
	import { goto } from "$app/navigation";
	import { darkMode } from "$lib/stores.js";

	let username = "";
	let password = "";
	let error = "";
	let loading = false;

	async function handleLogin() {
		if (!username || !password) {
			error = "Please enter username and password";
			return;
		}

		loading = true;
		error = "";

		try {
			const response = await fetch("/api/auth/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: username.trim(), password }),
			});

			const data = await response.json();

			if (response.ok) {
				// Load user settings after login to get dark mode preference
				try {
					const settingsRes = await fetch("/api/settings");
					if (settingsRes.ok) {
						const settingsData = await settingsRes.json();
						if (settingsData && settingsData.settings) {
							localStorage.setItem("enviroSyncSettings", JSON.stringify(settingsData.settings));
							darkMode.set(!!settingsData.settings.darkMode);
						}
					}
				} catch {}
				goto("/");
			} else {
				error = data.error || "Login failed";
			}
		} catch (err) {
			error = "Connection error. Please try again.";
		} finally {
			loading = false;
		}
	}

	function handleKeydown(e) {
		if (e.key === "Enter") {
			handleLogin();
		}
	}
</script>

<svelte:head>
	<title>EnviroSync - Login</title>
</svelte:head>

<div class="login-container">
	<div class="login-card">
		<div class="login-header">
			<div class="logo">E</div>
			<h1>EnviroSync</h1>
			<p class="login-subtitle">Environmental Monitoring System</p>
		</div>

		<form class="login-form" on:submit|preventDefault={handleLogin}>
			<div class="input-group">
				<label for="username">Username</label>
				<input type="text" id="username" bind:value={username} on:keydown={handleKeydown} placeholder="Enter username" autocomplete="username" disabled={loading} />
			</div>

			<div class="input-group">
				<label for="password">Password</label>
				<input type="password" id="password" bind:value={password} on:keydown={handleKeydown} placeholder="Enter password" autocomplete="current-password" disabled={loading} />
			</div>

			{#if error}
				<div class="error-message">{error}</div>
			{/if}

			<button type="submit" class="login-btn" disabled={loading}>
				{#if loading}
					<div class="btn-spinner"></div>
					Logging in...
				{:else}
					Log In
				{/if}
			</button>
		</form>
	</div>
</div>

<style>
	.login-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		width: 100%;
		background-color: var(--bg-primary);
		padding: 1rem;
	}

	.login-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 16px;
		padding: 3rem;
		width: 100%;
		max-width: 420px;
		box-shadow: var(--shadow);
	}

	.login-header {
		text-align: center;
		margin-bottom: 2.5rem;
	}

	.logo {
		width: 3.5rem;
		height: 3.5rem;
		background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
		border-radius: 0.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-weight: bold;
		font-size: 1.5rem;
		margin-bottom: 1rem;
	}

	.login-header h1 {
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.login-subtitle {
		color: var(--text-muted);
		font-size: 0.95rem;
		margin-top: 0.5rem;
	}

	.login-form {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.input-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.input-group label {
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.input-group input {
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 0.85rem 1rem;
		color: var(--text-primary);
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.2s ease;
		outline: none;
	}

	.input-group input::placeholder {
		color: var(--text-muted);
	}

	.input-group input:focus {
		border-color: var(--accent-blue);
	}

	.input-group input:disabled {
		opacity: 0.6;
	}

	.error-message {
		background: rgba(230, 80, 80, 0.12);
		border: 1px solid rgba(230, 80, 80, 0.3);
		color: var(--accent-red, #e65050);
		padding: 0.75rem 1rem;
		border-radius: 8px;
		font-size: 0.9rem;
		text-align: center;
	}

	.login-btn {
		background: var(--accent-blue);
		color: white;
		border: none;
		border-radius: 8px;
		padding: 0.85rem;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		font-family: inherit;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.login-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.login-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.btn-spinner {
		width: 18px;
		height: 18px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 480px) {
		.login-card {
			padding: 2rem 1.5rem;
		}
	}
</style>
