/**
 * Anonymous usage counts, off until someone turns them on.
 *
 * Cutroom's promise is that a recording never leaves the machine, and this
 * file is where that promise has to be kept honest. Everything that can ever
 * be sent is the `Event` union below: six event names and a handful of
 * numbers. There is no file name, no path, no transcript, and deliberately no
 * error text -- a failure message from the pipeline carries the path of the
 * recording that caused it, so failures report which stage they reached and
 * nothing else.
 *
 * This is forty lines of fetch rather than PostHog's SDK on purpose. Someone
 * who distrusts an open-source tool that phones home can read this one file
 * and know exactly what leaves; they cannot read a dependency that also ships
 * autocapture, session replay and surveys, whatever its settings say.
 */

/** The project's write-only ingest key. Public by design -- it can add events
 * and read nothing -- but absent in a checkout that hasn't set it, and then
 * nothing here does anything at all. */
const KEY = import.meta.env.VITE_POSTHOG_KEY ?? "";
const HOST = import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";

const CONSENT_KEY = "cutroom.telemetry";
const INSTALL_KEY = "cutroom.installId";

export type Consent = "on" | "off" | "unasked";

/** `unasked` is what makes the first-run card appear, so a browser that
 * refuses storage answers `off` instead: nothing is sent, and nobody is asked
 * the same question on every launch because the answer can't be kept. */
export function getConsent(): Consent {
	try {
		const saved = localStorage.getItem(CONSENT_KEY);
		return saved === "on" || saved === "off" ? saved : "unasked";
	} catch {
		return "off";
	}
}

export function setConsent(value: "on" | "off") {
	try {
		localStorage.setItem(CONSENT_KEY, value);
		// Turning it off drops the id too, so turning it back on later starts a
		// new one rather than rejoining everything sent before.
		if (value === "off") localStorage.removeItem(INSTALL_KEY);
	} catch {
		// Nothing to do: getConsent() answers `off` where storage fails.
	}
}

/** A random id for this install, made on first use. It is not derived from
 * anything about the machine or the person, so it identifies one copy of
 * Cutroom and nothing else, and deleting it (turning telemetry off) is the
 * whole of starting over. */
function installId(): string {
	try {
		const existing = localStorage.getItem(INSTALL_KEY);
		if (existing) return existing;
		const fresh = crypto.randomUUID();
		localStorage.setItem(INSTALL_KEY, fresh);
		return fresh;
	} catch {
		return "anonymous";
	}
}

/**
 * Every event Cutroom can send, in full.
 *
 * The set exists to answer one question the developer preview cannot answer
 * any other way: of the people who open Cutroom, how many get through the
 * install, and how many reach a finished video. Anything that doesn't serve
 * that isn't here.
 */
export type Event =
	| { name: "app_opened"; platform: string; version: string }
	| { name: "setup_ready"; seconds: number; captions: boolean }
	| { name: "processing_started" }
	| { name: "processing_finished"; seconds: number; people: number }
	/** The stage it got to, as a fraction, from the progress the screen was
	 * already showing. Never the message -- see the note at the top. */
	| { name: "processing_failed"; reached: number }
	| { name: "export_finished"; captions: boolean; trimDeadAir: boolean; shots: number };

export function track(event: Event) {
	if (!KEY || getConsent() !== "on") return;
	const { name, ...properties } = event;
	// Fire and forget. Telemetry never blocks a render, never retries, and
	// never reports a failure of its own: being offline is normal for a tool
	// that does all its work locally, and is not worth a word on screen.
	void fetch(`${HOST}/i/v0/e/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		keepalive: true,
		body: JSON.stringify({
			api_key: KEY,
			event: name,
			distinct_id: installId(),
			properties: {
				...properties,
				// No person profile and no location lookup. The project's own
				// settings have to agree -- see PRIVACY.md.
				$process_person_profile: false,
				$geoip_disable: true,
			},
		}),
	}).catch(() => {});
}

/** Coarse enough to be useful for "does the Windows build work" and no
 * finer. Not the user agent, which carries a browser build and an OS version. */
export function platform(): string {
	const ua = navigator.userAgent;
	if (/Mac/.test(ua)) return "mac";
	if (/Win/.test(ua)) return "windows";
	if (/Linux/.test(ua)) return "linux";
	return "other";
}
