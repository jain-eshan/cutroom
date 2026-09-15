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
				reject(new Error(`Processing failed (${xhr.status}): ${xhr.responseText}`));
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
}

export interface Health {
	status: string;
	/** Whether this install's ffmpeg was built with libass. A normal macOS
	 * `brew install ffmpeg` is not, so the setup gate says so up front rather
	 * than letting a 15-minute export fail at the end. */
	captions: boolean;
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

/** One upload, both analyses. These were separate endpoints called in
 * parallel, which uploaded the same file twice. */
export function processVideo(
	file: File,
	jobId: string,
	onUploadProgress?: (fraction: number) => void,
): Promise<ProcessResponse> {
	return postFile("/process", file, { jobId }, onUploadProgress);
}

export interface LayoutChoice {
	turnIndex: number;
	/** Who is on screen for this turn, already resolved from diarisation plus
	 * any manual correction. null = nobody, which renders as the wide shot. */
	personId: number | null;
	start: number;
	end: number;
	defaultLayout: "original" | "zoom";
	finalLayout: "original" | "zoom" | "split";
}

/** An overlap window resolved to people rather than diarisation speakers. */
export interface OverlapSegment {
	start: number;
	end: number;
	personIds: number[];
}

export async function exportVideo(
	file: File,
	layoutChoices: LayoutChoice[],
	overlapSegments: OverlapSegment[],
	faces: DetectFacesResponse,
	sessionId: string,
	words: Word[],
	captions: boolean,
	trimDeadAir: boolean,
): Promise<Blob> {
	const form = new FormData();
	form.append("file", file);
	form.append("layoutChoices", JSON.stringify(layoutChoices));
	form.append("overlapSegments", JSON.stringify(overlapSegments));
	// Sent as a file, not a text field: the server caps text fields at 1MB and
	// face keyframes for a full-length episode are larger than that.
	form.append("faces", new Blob([JSON.stringify(faces)], { type: "application/json" }), "faces.json");
	form.append("sessionId", sessionId);
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
			detail = (JSON.parse(body) as { detail?: string }).detail ?? body;
		} catch {
			// Not JSON (a proxy error page, say) -- show it as-is.
		}
		throw new Error(`Export failed (${res.status}): ${detail}`);
	}
	return res.blob();
}
