import adapter from "@sveltejs/adapter-node";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		serviceWorker: {
			register: false, // Disable in development to avoid import issues
		},
	},
};

export default config;
