<script>
	import { goto } from "$app/navigation";

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
				body: JSON.stringify({ username, password }),
			});

			const data = await response.json();

			if (response.ok) {
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
		background-color: #1a1a1a;
		padding: 1rem;
	}

	.login-card {
		background: #2a2a2a;
		border: 1px solid #444444;
		border-radius: 16px;
		padding: 3rem;
		width: 100%;
		max-width: 420px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.login-header {
		text-align: center;
		margin-bottom: 2.5rem;
	}

	.logo {
		width: 3.5rem;
		height: 3.5rem;
		background: linear-gradient(135deg, #4a90e2, #9b59b6);
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
		color: #ffffff;
		margin: 0;
	}

	.login-subtitle {
		color: #888888;
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
		color: #b3b3b3;
	}

	.input-group input {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid #444444;
		border-radius: 8px;
		padding: 0.85rem 1rem;
		color: #ffffff;
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.2s ease;
		outline: none;
	}

	.input-group input::placeholder {
		color: #666666;
	}

	.input-group input:focus {
		border-color: #4a90e2;
		background: rgba(74, 144, 226, 0.05);
	}

	.input-group input:disabled {
		opacity: 0.6;
	}

	.error-message {
		background: rgba(244, 67, 54, 0.15);
		border: 1px solid rgba(244, 67, 54, 0.3);
		color: #f44336;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		font-size: 0.9rem;
		text-align: center;
	}

	.login-btn {
		background: #4a90e2;
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
		background: #357abd;
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
