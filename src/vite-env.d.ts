/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_URL?: string;
	/** PostHog's write-only ingest key, and where to send to. Unset in a plain
	 * checkout, which leaves telemetry dormant however anyone answers the
	 * first-run card -- see src/lib/telemetry.ts. */
	readonly VITE_POSTHOG_KEY?: string;
	readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

/** The running version, from package.json at build time (see vite.config.ts).
 * Telemetry reports it, because the preview updates by hand and "which
 * version is that failure from" is otherwise unanswerable. */
declare const __APP_VERSION__: string;
