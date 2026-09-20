/**
 * Caption cues for the live preview, grouped exactly the way the export
 * groups them.
 *
 * A direct port of `build_caption_cues` in `server/pipeline/captions.py`.
 * There is no shared-code mechanism between the TypeScript and Python
 * runtimes, so the constants below are the same numbers written twice and
 * drift shows up as "the captions I saw aren't the captions I got" -- the
 * same failure mode `personCrop`/`person_crop` and `exportPanes`/
 * `_segment_filter` already guard against, and the reason `captions.test.ts`
 * and `test_captions.py` assert the same cases.
 *
 * `Word` is imported type-only, so this module pulls in nothing at runtime
 * and Node's test runner can load it.
 */
import type { Word } from "@/lib/api";

/** Broadcast captioning lands around 32-42 characters for a single line at
 * this size; without a cap a monologue becomes one endless cue. */
const MAX_LINE_CHARS = 42;
/** Reading speed, not just length, bounds a caption's welcome. */
const MAX_CUE_DURATION = 3.5;
/** A gap this long reads as a new thought, so the cue breaks there rather
 * than mid-flow. */
const BREAK_ON_PAUSE = 0.6;

export interface CaptionCue {
	start: number;
	end: number;
	text: string;
}

/** `{` and `}` delimit ASS override blocks; the export strips them so stray
 * punctuation can't be read as a formatting tag. The preview strips them for
 * the duller reason that it must show the same string. */
function clean(text: string): string {
	return text.replaceAll("{", "").replaceAll("}", "").trim();
}

export function buildCaptionCues(
	words: Word[],
	maxLineChars = MAX_LINE_CHARS,
	maxCueDuration = MAX_CUE_DURATION,
	breakOnPause = BREAK_ON_PAUSE,
): CaptionCue[] {
	const cues: CaptionCue[] = [];
	let current: Word[] = [];

	const flush = () => {
		if (current.length === 0) return;
		const text = clean(current.map((w) => w.text).join(" "));
		if (text) cues.push({ start: current[0].start, end: current[current.length - 1].end, text });
		current = [];
	};

	for (const word of words) {
		if (!word.text.trim()) continue;
		if (current.length > 0) {
			const pause = word.start - current[current.length - 1].end;
			const candidate = [...current, word].map((w) => w.text).join(" ");
			const duration = word.end - current[0].start;
			if (pause >= breakOnPause || candidate.length > maxLineChars || duration > maxCueDuration) flush();
		}
		current.push(word);
	}
	flush();
	return cues;
}

/**
 * The cue on screen at `t`, or null between cues.
 *
 * Binary search rather than a scan: this runs on every `timeupdate`, and a
 * 53-minute episode is ~2,600 cues built from 8,824 words.
 */
export function cueAt(cues: CaptionCue[], t: number): CaptionCue | null {
	let lo = 0;
	let hi = cues.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (t < cues[mid].start) hi = mid - 1;
		else if (t >= cues[mid].end) lo = mid + 1;
		else return cues[mid];
	}
	return null;
}
