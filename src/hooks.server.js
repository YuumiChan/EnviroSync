import { validateSession } from "$lib/server/db.js";
import { redirect } from "@sveltejs/kit";

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	const sessionId = event.cookies.get("session");
	const user = validateSession(sessionId);
	event.locals.user = user;

	// Public paths that don't require auth
	const publicPaths = ["/login", "/api/auth/login"];
	const isPublicPath = publicPaths.some((p) => event.url.pathname.startsWith(p));

	// If not authenticated and not on a public path, redirect to login
	// But for API requests, return 401 instead of redirecting
	if (!user && !isPublicPath) {
		if (event.url.pathname.startsWith("/api/")) {
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}
		throw redirect(303, "/login");
	}

	// If authenticated and on login page, redirect to dashboard
	if (user && event.url.pathname === "/login") {
		throw redirect(303, "/");
	}

	return resolve(event);
}
