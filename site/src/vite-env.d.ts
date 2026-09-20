/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** PostHog's write-only ingest key, and where to send to. Set in Vercel's
	 * environment variables; unset in a checkout, which leaves the site's
	 * analytics dormant -- see site/src/analytics.ts. */
	readonly VITE_POSTHOG_KEY?: string;
	readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
