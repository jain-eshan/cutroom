export interface Turn {
	speaker: number;
	start: number;
	end: number;
	text: string;
}

export interface TranscribeResponse {
	turns: Turn[];
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

export interface FaceTrack {
	id: number;
	thumbnail: string;
	keyframes: FaceKeyframe[];
}

export interface DetectFacesResponse {
	frameWidth: number;
	frameHeight: number;
	tracks: FaceTrack[];
}

const API_BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787";

async function postFile<T>(path: string, file: File, params?: Record<string, string>): Promise<T> {
	const form = new FormData();
	form.append("file", file);

	const url = new URL(path, API_BASE);
	for (const [key, value] of Object.entries(params ?? {})) {
		url.searchParams.set(key, value);
	}

	const res = await fetch(url, { method: "POST", body: form });
	if (!res.ok) {
		throw new Error(`Processing failed (${res.status}): ${await res.text()}`);
	}
	return res.json();
}

export function transcribe(file: File, numSpeakers?: number): Promise<TranscribeResponse> {
	return postFile("/transcribe", file, numSpeakers ? { num_speakers: String(numSpeakers) } : undefined);
}

export function detectFaces(file: File): Promise<DetectFacesResponse> {
	return postFile("/detect-faces", file);
}
