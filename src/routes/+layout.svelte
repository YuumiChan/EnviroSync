<script>
	import { browser } from "$app/environment";
	import { page } from "$app/stores";
	import favicon from "$lib/assets/favicon.svg";
	import Sidebar from "$lib/components/Sidebar.svelte";
	import { setHiddenDeviceIds } from "$lib/deviceFilter.js";
	import { darkMode, magnitudeMode, sidebarCollapsed } from "$lib/stores.js";
	import { onMount } from "svelte";
	import "../app.css";

	// Svelte 5 syntax for children
	let { children } = $props();

	let isLoginPage = $derived($page.url.pathname === "/login");

	if (browser) {
		console.log("EnviroSync app initialized");

		// Service worker registration - only register if available
		if ("serviceWorker" in navigator && import.meta.env.PROD) {
			navigator.serviceWorker
				.register("/service-worker.js")
				.then((registration) => {
					console.log("Service Worker registered successfully:", registration);
				})
				.catch((error) => {
					console.log("Service Worker registration failed:", error);
				});
		}
	}

	onMount(() => {
		// On mobile, start with sidebar collapsed
		if (window.innerWidth <= 768) {
			sidebarCollapsed.set(true);
		}

		// Sync settings from server to localStorage
		fetch("/api/settings")
			.then((res) => {
				if (res.ok) return res.json();
				return null;
			})
			.then((data) => {
				if (data && data.settings) {
					localStorage.setItem("enviroSyncSettings", JSON.stringify(data.settings));
					magnitudeMode.set(!!data.settings.magnitudeMode);
					darkMode.set(!!data.settings.darkMode);
				}
			})
			.catch(() => {});

		// Sync shared settings
		fetch("/api/settings?type=shared")
			.then((res) => {
				if (res.ok) return res.json();
				return null;
			})
			.then((data) => {
				if (data && data.settings) {
					localStorage.setItem("enviroSyncSharedSettings", JSON.stringify(data.settings));
				}
			})
			.catch(() => {});

		// Sync hidden devices from server to localStorage
		fetch("/api/device-visibility")
			.then((res) => {
				if (res.ok) return res.json();
				return null;
			})
			.then((data) => {
				if (data && data.hiddenDevices) {
					setHiddenDeviceIds(data.hiddenDevices);
				}
			})
			.catch(() => {});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if isLoginPage}
	<div class:dark-mode={$darkMode}>
		{@render children()}
	</div>
{:else}
	<div class="app-container" class:sidebar-collapsed={$sidebarCollapsed} class:dark-mode={$darkMode}>
		<Sidebar />
		<main class="main-content">
			{@render children()}
		</main>
	</div>
{/if}
