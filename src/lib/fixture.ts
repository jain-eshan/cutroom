import type { CastResult } from "@/features/faces/CastScreen";
import type { BBox, DetectFacesResponse, FaceKeyframe, MatchResult, OverlapWindow, Person, ProcessResponse, Turn, Word } from "@/lib/api";

/** Drops straight into the editor with a canned three-person conversation --
 * no upload, no processing wait, no backend even needed to be running (the
 * editor's waveform/thumbnail fetches already fail silently, same as any
 * other job the server has never heard of). For manual and agent-driven QA
 * of the editor itself, which is what most of this app's surface area is.
 * Dev-only: a packaged install has no reason to expose a way to skip real
 * processing. */
export function isFixtureMode(): boolean {
	return import.meta.env.DEV && new URLSearchParams(window.location.search).has("fixture");
}

export const FIXTURE_JOB_ID = "fixture";
export const FIXTURE_FILE_NAME = "Fixture episode.mp4";

/** Even timing across a turn is good enough for a fixture -- nothing reads
 * these as real transcription confidence, only as word boundaries to snap
 * to and captions to burn. */
function wordsFromTurn(turn: Turn): Word[] {
	const parts = turn.text.split(" ");
	const step = (turn.end - turn.start) / parts.length;
	return parts.map((text, i) => ({
		start: turn.start + i * step,
		end: turn.start + (i + 1) * step,
		text,
	}));
}

/** A small flat-colour circle with an initial, so the cast and face-picker
 * screens have something to render without shipping a binary asset. */
function thumbnail(initial: string, hue: number): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="48" fill="hsl(${hue},55%,45%)"/><text x="48" y="63" font-size="42" text-anchor="middle" fill="white" font-family="sans-serif">${initial}</text></svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A keyframe every 1.5s across the episode, all at the same seat -- nobody
 * moves in this fixture. A single keyframe at t=0 used to be enough, before
 * `resolveFraming`/`build_render_segments` started checking whether a
 * sighting is actually near the moment being framed (EDGE_CASES.md B7):
 * once they did, every shot past the first two seconds of the 70s fixture
 * episode would have found nobody "visible" and gone wide. Real face
 * detection samples about once a second for the episode's whole length
 * (EDGE_CASES.md B8's "Today" line), so this is closer to real input than
 * the single keyframe was, not just a workaround for the new check. */
function seatedThroughout(bbox: BBox, duration: number, step = 1.5): FaceKeyframe[] {
	const keyframes: FaceKeyframe[] = [];
	for (let t = 0; t <= duration; t += step) keyframes.push({ t, bbox });
	return keyframes;
}

const EPISODE_DURATION_S = 70;

const turns: Turn[] = [
	{ speaker: 0, start: 0, end: 8.5, text: "Welcome back to the show, today we are talking about how podcasts get edited." },
	{ speaker: 1, start: 8.5, end: 14, text: "Thanks for having me, I have been excited about this one all week." },
	{ speaker: 2, start: 14, end: 21, text: "Same here, I think the framing question is the part people underestimate." },
	{ speaker: 0, start: 21, end: 27, text: "Right, and that is exactly why we built the auto framing in the first place." },
	{ speaker: 1, start: 27.5, end: 34, text: "It is wild how much a bad cut can ruin an otherwise great conversation." },
	{ speaker: 2, start: 34, end: 41, text: "Sorry, go ahead, I did not mean to talk over you there." },
	{ speaker: 1, start: 41, end: 46, text: "No it's fine, I was basically done anyway." },
	{ speaker: 0, start: 46, end: 55, text: "Let's wrap up this segment with one tip for someone editing their first episode." },
	{ speaker: 2, start: 55, end: 63, text: "Watch the cut points, not just the words -- a cut a half second early still reads as a mistake." },
	{ speaker: 1, start: 63, end: 70, text: "Great note to end on, thanks everyone for listening this week." },
];

const overlapWindows: OverlapWindow[] = [{ start: 33.6, end: 34, speakers: [1, 2] }];

const words: Word[] = turns.flatMap(wordsFromTurn);

const people: Person[] = [
	{
		id: 0,
		thumbnail: thumbnail("A", 210),
		keyframes: seatedThroughout({ x: 200, y: 180, width: 300, height: 300 }, EPISODE_DURATION_S),
		detectionCount: 1180,
	},
	{
		id: 1,
		thumbnail: thumbnail("B", 30),
		keyframes: seatedThroughout({ x: 800, y: 160, width: 300, height: 320 }, EPISODE_DURATION_S),
		detectionCount: 1150,
	},
	{
		id: 2,
		thumbnail: thumbnail("C", 130),
		keyframes: seatedThroughout({ x: 1400, y: 190, width: 300, height: 300 }, EPISODE_DURATION_S),
		detectionCount: 1120,
	},
];

const faces: DetectFacesResponse = { frameWidth: 1920, frameHeight: 1080, people };

const match: MatchResult = {
	speakerToPerson: { 0: 0, 1: 1, 2: 2 },
	matches: [
		{ speaker: 0, personId: 0, confidence: 0.97, judgedSeconds: 40 },
		{ speaker: 1, personId: 1, confidence: 0.95, judgedSeconds: 35 },
		{ speaker: 2, personId: 2, confidence: 0.71, judgedSeconds: 22 },
	],
	// Exercises the review-flag stepper the same way a real uncertain match would.
	notes: [{ kind: "low_confidence", speakers: [2], personIds: [2] }],
};

export const fixtureData: ProcessResponse = { turns, overlapWindows, words, faces, match };

export const fixtureCast: CastResult = {
	names: { 0: "Alice", 1: "Bob", 2: "Cara" },
	speakerToPerson: { 0: 0, 1: 1, 2: 2 },
	voiceNames: {},
};
