export interface Turn {
	speaker: number;
	start: number;
	end: number;
	text: string;
}

export interface OverlapWindow {
	start: number;
	end: number;
	speakers: number[];
}

/** One transcribed word with its own timing, independent of turn boundaries.
 * Captions need this tighter timing than a turn provides. */
export interface Word {
	start: number;
	end: number;
	text: string;
}

/** What the pipeline thinks each voice's face is, and how sure it is. A
 * suggestion for the cast screen, not a decision — the editor confirms it. */
export interface VoiceFaceMatch {
	speaker: number;
	personId: number | null;
	/** Share of the seconds where this voice was heard and some face was
	 * visibly talking that pointed at this person. */
	confidence: number;
	judgedSeconds: number;
}

/** Something worth the editor's attention, as data rather than a sentence —
 * the wording lives in the UI because only the UI knows what the editor has
 * named these people. */
export interface MatchNote {
	kind: "over_split" | "voice_unmatched" | "person_unmatched" | "low_confidence";
	speakers: number[];
	personIds: number[];
}

export interface MatchResult {
	speakerToPerson: Record<number, number>;
	matches: VoiceFaceMatch[];
	notes: MatchNote[];
}

export interface ProcessResponse {
	turns: Turn[];
	overlapWindows: OverlapWindow[];
	words: Word[];
	faces: DetectFacesResponse;
	match: MatchResult;
	/** Only present from `getJob` -- a resumed or reopened session has no
	 * browser-held upload left to read this from. */
	filename?: string;
}

export interface BBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface FaceKeyframe {
	t: number;
	bbox: BBox;
}

/** One real human in the video, assembled by face recognition from however
 * many detection fragments the tracker produced for them. Bounding-box
 * tracking alone splits one person into several "tracks" every time they turn
 * their head; identity clustering merges those back together. */
export interface Person {
	id: number;
	thumbnail: string;
	keyframes: FaceKeyframe[];
	/** How many sampled frames this person appeared in -- people who are
	 * actually in the conversation appear in nearly all of them. */
	detectionCount: number;
}

export interface DetectFacesResponse {
	frameWidth: number;
	frameHeight: number;
	people: Person[];
}

const API_BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787";

/** Upload progress needs XMLHttpRequest -- fetch() has no way to report how
 * many bytes of the request body have gone out, and a multi-GB upload with no
 * feedback looks identical to a hung app. */
function postFile<T>(
	path: string,
	file: File,
	params?: Record<string, string>,
	onUploadProgress?: (fraction: number) => void,
): Promise<T> {
	const form = new FormData();
	form.append("file", file);

	const url = new URL(path, API_BASE);
	for (const [key, value] of Object.entries(params ?? {})) {
		url.searchParams.set(key, value);
	}

	return new Promise<T>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", url.toString());
		xhr.responseType = "text";

		if (onUploadProgress) {
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
			};
			xhr.upload.onload = () => onUploadProgress(1);
		}

		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					resolve(JSON.parse(xhr.responseText) as T);
				} catch (err) {
					reject(new Error(`Could not parse response: ${String(err)}`));
				}
			} else {
				// FastAPI wraps the actionable sentence in {"detail": ...}; the
				// envelope is noise in the one line the user is meant to read.
				let detail = xhr.responseText;
				try {
					const parsed = (JSON.parse(xhr.responseText) as { detail?: unknown }).detail;
					if (typeof parsed === "string") detail = parsed;
				} catch {
					// Not JSON -- show it as-is.
				}
				reject(new Error(`Processing failed (${xhr.status}): ${detail}`));
			}
		};
		xhr.onerror = () => reject(new Error("Could not reach the local processing service."));
		xhr.send(form);
	});
}

export interface StageProgress {
	stage: string;
	fraction: number;
	done: boolean;
}

export interface JobProgress {
	transcribe: StageProgress;
	faces: StageProgress;
	/** Runs after the other two — matching voices to faces needs both. */
	match: StageProgress;
	/** The tail of the transcript as it's produced. A progress bar proves time
	 * passed; this proves work happened. */
	lines: string[];
	/** How far into the recording transcription has reached, and the
	 * recording's length — both in seconds. */
	position: number;
	duration: number;
	/** Ids of the people recognised so far; the images come from
	 * `faceThumbnailUrl` so they're fetched once each, not on every poll. */
	people: number[];
	/** How many timeline overview thumbnails are ready. The bytes come from
	 * `timelineThumbnailUrl`, one at a time -- same reasoning as `people`. */
	thumbnailCount: number;
	/** Set once, if the background job failed -- a missing audio track, a
	 * diarisation setup problem, anything unexpected. `/process` returns as
	 * soon as the upload is saved, so this is the only way a failure that
	 * happens afterward reaches the browser. */
	error: string | null;
}

/** Stable per (job, person), and immutable once written, so the browser
 * fetches each face exactly once however often the snapshot is polled. */
export function faceThumbnailUrl(jobId: string, personId: number): string {
	return new URL(`/progress/${jobId}/face/${personId}`, API_BASE).toString();
}

/** Stable per (job, index), and immutable once written -- same reasoning as
 * `faceThumbnailUrl`. */
export function timelineThumbnailUrl(jobId: string, index: number): string {
	return new URL(`/progress/${jobId}/thumbnail/${index}`, API_BASE).toString();
}

/** The episode's amplitude envelope, as a fixed number of normalised (0-1)
 * buckets across its whole length. Computed once the upload's audio has been
 * extracted; 404s until then, same as a face requested before it exists. */
export async function getWaveform(jobId: string): Promise<number[]> {
	const res = await fetch(new URL(`/progress/${jobId}/waveform`, API_BASE));
	if (!res.ok) throw new Error(`Waveform unavailable (${res.status})`);
	return ((await res.json()) as { peaks: number[] }).peaks;
}

export interface Health {
	status: string;
	/** Whether the Hugging Face token speaker diarisation needs is set.
	 * Required: /process refuses the job without it. */
	diarization: boolean;
	/** Whether this install's ffmpeg was built with libass. A normal macOS
	 * `brew install ffmpeg` is not, so the setup gate says so up front rather
	 * than letting a 15-minute export fail at the end. */
	captions: boolean;
}

/** Hand the Hugging Face token to the local service, which checks it with
 * Hugging Face and saves it to server/.env. Throws with the service's own
 * plain-English reason when the token can't be used. */
export async function saveHfToken(token: string): Promise<void> {
	const res = await fetch(new URL("/setup/hf-token", API_BASE), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token }),
	});
	if (res.ok) return;
	let detail = `The service couldn't save the token (${res.status}).`;
	try {
		const parsed = ((await res.json()) as { detail?: unknown }).detail;
		if (typeof parsed === "string") detail = parsed;
	} catch {
		// Not JSON -- keep the generic line.
	}
	throw new Error(detail);
}

export async function getHealth(): Promise<Health> {
	const res = await fetch(new URL("/health", API_BASE));
	if (!res.ok) throw new Error(`Processing service unhealthy (${res.status})`);
	return res.json();
}

export async function getProgress(jobId: string): Promise<JobProgress> {
	const res = await fetch(new URL(`/progress/${jobId}`, API_BASE));
	if (!res.ok) throw new Error(`Progress unavailable (${res.status})`);
	return res.json();
}

/** Saves the upload and starts processing in the background, returning as
 * soon as that's true rather than waiting for the whole pipeline -- closing
 * the tab used to cancel the job outright, because the server used to do
 * everything inside this one request. Poll `getProgress`, then `getJob`
 * once it reports done. */
export function processVideo(
	file: File,
	jobId: string,
	onUploadProgress?: (fraction: number) => void,
): Promise<{ jobId: string }> {
	return postFile("/process", file, { jobId }, onUploadProgress);
}

/** Same as `processVideo`, but for the desktop app: `path` is the
 * recording's real location on this machine (see `src/lib/electron.ts`), so
 * the service reads it directly instead of the browser uploading a copy
 * through the request body. */
export async function processVideoAtPath(path: string, jobId: string): Promise<{ jobId: string }> {
	const res = await fetch(new URL("/process/local", API_BASE), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path, jobId }),
	});
	if (res.ok) return res.json();
	let detail = `Processing failed (${res.status}).`;
	try {
		const parsed = ((await res.json()) as { detail?: unknown }).detail;
		if (typeof parsed === "string") detail = parsed;
	} catch {
		// Not JSON -- keep the generic line.
	}
	throw new Error(detail);
}

/** The finished result of a job started with `processVideo` -- what used to
 * come back directly from that call. Also how a saved episode is reopened:
 * same shape, whether the job finished a second ago or a week ago. */
export async function getJob(jobId: string): Promise<ProcessResponse> {
	const res = await fetch(new URL(`/jobs/${jobId}`, API_BASE));
	if (!res.ok) throw new Error(`Job unavailable (${res.status})`);
	return res.json();
}

export interface SavedEpisode {
	jobId: string;
	filename: string;
	createdAt: number;
}

/** Every finished job on this machine, newest first -- "saved episodes". */
export async function listJobs(): Promise<SavedEpisode[]> {
	const res = await fetch(new URL("/jobs", API_BASE));
	if (!res.ok) throw new Error(`Could not list saved episodes (${res.status})`);
	return res.json();
}

export async function deleteJob(jobId: string): Promise<void> {
	const res = await fetch(new URL(`/jobs/${jobId}`, API_BASE), { method: "DELETE" });
	if (!res.ok) throw new Error(`Could not delete that episode (${res.status})`);
}

/** The original recording, for playback -- streamed from disk rather than
 * held in browser memory, so this works whether or not the tab that
 * uploaded it is still the one asking (a reload, or a saved episode
 * reopened later both have no `File` object left to play from). */
export function jobMediaUrl(jobId: string): string {
	return new URL(`/jobs/${jobId}/media`, API_BASE).toString();
}

/** What the renderer needs from a framing region. `source` rides along so the
 * decision log can tell what was suggested from what the editor changed. */
export interface ExportRegion {
	start: number;
	end: number;
	layout: "zoom" | "split";
	personIds: number[];
	source: "suggested" | "user";
	cropNudge?: { x: number; y: number };
}

export async function exportVideo(
	jobId: string,
	regions: ExportRegion[],
	turnRanges: { start: number; end: number }[],
	faces: DetectFacesResponse,
	words: Word[],
	captions: boolean,
	trimDeadAir: boolean,
): Promise<Blob> {
	const form = new FormData();
	// The recording itself is already on disk from /process (see
	// pipeline/jobs.py server-side) -- re-uploading a multi-GB file a second
	// time just to export it was pure waste. Also names the decision log.
	form.append("jobId", jobId);
	form.append("regions", JSON.stringify(regions));
	// Only used when trimming: dead air is measured against where speech
	// actually is, which regions deliberately don't describe.
	form.append("turns", JSON.stringify(turnRanges));
	// Sent as a file, not a text field: the server caps text fields at 1MB and
	// face keyframes for a full-length episode are larger than that.
	form.append("faces", new Blob([JSON.stringify(faces)], { type: "application/json" }), "faces.json");
	// A file part for the same reason as faces — word timestamps grow with
	// episode length.
	form.append("words", new Blob([JSON.stringify(words)], { type: "application/json" }), "words.json");
	form.append("captions", String(captions));
	form.append("trimDeadAir", String(trimDeadAir));

	const res = await fetch(new URL("/export", API_BASE), { method: "POST", body: form });
	if (!res.ok) {
		// FastAPI puts the actionable part in `detail`; showing the raw JSON
		// envelope buries advice the user is meant to act on.
		const body = await res.text();
		let detail = body;
		try {
			const parsed = (JSON.parse(body) as { detail?: unknown }).detail;
			if (typeof parsed === "string") {
				detail = parsed;
			} else if (Array.isArray(parsed)) {
				// A 422 carries a list of validation errors, not a sentence --
				// interpolated raw it reads "[object Object]", which is useless in
				// the one place a technical string is supposed to be copyable.
				detail = parsed
					.map((e: { loc?: unknown[]; msg?: string }) => `${e.loc?.at(-1) ?? "request"}: ${e.msg ?? "invalid"}`)
					.join("; ");
			}
		} catch {
			// Not JSON (a proxy error page, say) -- show it as-is.
		}
		throw new Error(`Export failed (${res.status}): ${detail}`);
	}
	return res.blob();
}
