/**
 * The landing page's analytics. Two of them, on purpose:
 *
 * Vercel Web Analytics (wired up in main.tsx) answers "how many people came,
 * and from where" without a cookie, so the page needs no consent banner.
 *
 * PostHog answers the question that actually matters here -- of the people
 * who land, how many reach the waitlist, and how many take the download --
 * which is a funnel, and a pageview counter cannot draw one.
 *
 * This is the marketing site, not the app. The app's telemetry is a different
 * thing under a different promise: opt-in, no SDK, and written out event by
 * event in src/lib/telemetry.ts.
 */

const KEY = import.meta.env.VITE_POSTHOG_KEY ?? "";
const HOST = import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";

export type SiteEvent =
	| { name: "download_clicked"; platform: "mac" | "windows" }
	/** The waitlist actually came into view -- the middle of the funnel, and
	 * the difference between "didn't want it" and "never got that far". */
	| { name: "waitlist_seen" }
	| { name: "waitlist_submitted" }
	| { name: "repo_opened" };

/** Imported on demand, which is the whole reason this indirection exists:
 * posthog-js is around 100KB gzipped, and putting it in the page's own bundle
 * would slow the first paint to measure the first paint. Loaded after `load`
 * instead, as its own chunk. */
let pending: Promise<{ capture: (name: string, properties: object) => void }> | null = null;

function client() {
	if (!KEY) return null;
	pending ??= import("posthog-js").then(({ default: posthog }) => {
		posthog.init(KEY, {
			api_host: HOST,
			// Recording someone reading a landing page is more than this needs
			// to know, and it would sit oddly beside the rest of the product.
			disable_session_recording: true,
			// Nobody signs in here, so there is no one to build a profile of.
			person_profiles: "identified_only",
		});
		return posthog;
	});
	return pending;
}

export function initAnalytics() {
	// Unset in a checkout, and on any preview deployment that hasn't been
	// given the key: nothing loads, and every track() below is a no-op.
	if (!KEY) return;
	if (document.readyState === "complete") void client();
	else window.addEventListener("load", () => void client(), { once: true });
}

export function track(event: SiteEvent) {
	const posthog = client();
	if (!posthog) return;
	const { name, ...properties } = event;
	// Every outbound link here opens in a new tab, so the page is still around
	// to finish this -- and a lost event is never worth a broken click.
	void posthog.then((ph) => ph.capture(name, properties)).catch(() => {});
}
