import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProgress, getWaveform, timelineThumbnailUrl, type BBox, type DetectFacesResponse, type Health, type OverlapWindow, type Person, type Turn, type Word } from "@/lib/api";
import type { CastResult } from "@/features/faces/CastScreen";
import { DUO_SPLIT_MAX, exportPanes, fitBox, personCrop } from "@/lib/faceCrop";
import { buildCaptionCues, cueAt } from "@/lib/captions";
import { wordAt, wordSlice } from "@/lib/transcript";
import { TimelineTray } from "@/features/timeline/TimelineTray";
import {
	FRAMING_STYLE_LABELS,
	LAYOUT_LABELS,
	MAX_CROP_NUDGE,
	type FramingRegion,
	type FramingStyle,
} from "@/features/timeline/types";
import {
	MIN_REGION_S,
	addRegion,
	orderBySeat,
	otherSpeakerNear,
	reconcileWithStyle,
	regionAt,
	resizeRegion,
	resolveFraming,
	splitRegion,
	suggestRegions,
} from "@/features/timeline/regions";
import {
	MIN_VIEW_S,
	formatTimecode as formatTime,
	parseTimecode,
	reveal,
	stepToEdge,
	zoomView,
	type TimeSpan,
} from "@/features/timeline/timelineView";
import { Button, CheckMark, PlayButton, SectionLabel, Triangle } from "@/components/ui";

// One per person, not per pane: the handoff's palette stops at three because
// that is the composite pane cap, but these identify who is speaking, and a
// four-person show has four. See `--color-s4` in src/index.css.
const SPEAKER_DOT = ["bg-s1", "bg-s2", "bg-s3", "bg-s4"];

/** Enough to take a real slip back, not so much it holds every drag frame forever. */
const HISTORY_LIMIT = 200;

// J is a jump back rather than Resolve's reverse play: browsers can't play
// video backwards smoothly.
const SHORTCUTS: [string, string][] = [
	["Space", "Play or pause"],
	["K", "Pause"],
	["L", "Play. Press again for 2× or 4×"],
	["J", "Back 5 seconds"],
	["← →", "Back or forward 1 second, 10 with Shift"],
	["↑ ↓", "Previous or next shot"],
	["Tab", "Next line to review. With Shift, previous"],
	["= −", "Zoom the timeline in or out"],
	["Shift Z", "Show the whole episode"],
	["⌘Z", "Undo. With Shift, redo"],
	["S", "Split the picked shot at the playhead"],
	["Delete", "Make the picked shot wide"],
	["Esc", "Unpick the shot"],
];

function overlapFor(overlapWindows: OverlapWindow[], start: number, end: number): OverlapWindow | undefined {
	return overlapWindows.find((w) => w.start < end && w.end > start);
}

function useElementSize() {
	// A plain useRef + useEffect([]) only measures what's mounted at the
	// component's own mount time, but cropped layouts mount conditionally.
	// A callback ref fires on every attach/detach, which is what that needs.
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });
	const ref = useCallback((node: HTMLDivElement | null) => setElement(node), []);

	useEffect(() => {
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			setSize({ width, height });
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);

	return [ref, size] as const;
}

/**
 * One pane showing a crop of the source video, positioned in real pixels so
 * it matches exactly what ffmpeg will render. Kept in sync with the primary
 * "driver" video by one idempotent sync() on every relevant driver event --
 * splitting time-correction and play/pause into separate listeners lets them
 * race, because a currentTime write can interrupt an in-flight play().
 */
function CroppedVideo({
	videoUrl,
	bbox,
	frameWidth,
	frameHeight,
	pane,
	displayWidth,
	label,
	cropNudge,
	driverRef,
}: {
	videoUrl: string;
	bbox: BBox | undefined;
	frameWidth: number;
	frameHeight: number;
	/** The pane ffmpeg renders this person into, in source pixels (see
	 * `exportPanes`) -- what the crop is computed against. */
	pane: { width: number; height: number };
	/** How wide that pane is on screen right now, which only scales the
	 * result. Kept apart from `pane` so the window's size can't change the
	 * crop. */
	displayWidth: number;
	label?: string;
	cropNudge?: { x: number; y: number };
	driverRef: React.RefObject<HTMLVideoElement | null>;
}) {
	const paneRef = useRef<HTMLVideoElement>(null);

	useEffect(() => {
		const driver = driverRef.current;
		const pane = paneRef.current;
		if (!driver || !pane) return;

		const sync = () => {
			if (Math.abs(pane.currentTime - driver.currentTime) > 0.15) {
				pane.currentTime = driver.currentTime;
			}
			pane.playbackRate = driver.playbackRate;
			if (driver.paused && !pane.paused) pane.pause();
			else if (!driver.paused && pane.paused) pane.play().catch(() => {});
		};

		for (const ev of ["timeupdate", "seeked", "play", "pause", "ratechange"]) {
			driver.addEventListener(ev, sync);
		}
		sync();
		return () => {
			for (const ev of ["timeupdate", "seeked", "play", "pause", "ratechange"]) {
				driver.removeEventListener(ev, sync);
			}
		};
	}, [driverRef]);

	if (!bbox || pane.width === 0 || pane.height === 0 || displayWidth === 0) {
		return <div className="h-full w-full bg-plate-b" />;
	}

	const crop = personCrop(bbox, frameWidth, frameHeight, pane.width, pane.height, undefined, cropNudge);
	const displayScale = displayWidth / crop.width;

	return (
		<div className="relative h-full w-full overflow-hidden">
			<video
				ref={paneRef}
				src={videoUrl}
				muted
				playsInline
				style={{
					position: "absolute",
					left: -crop.x * displayScale,
					top: -crop.y * displayScale,
					width: frameWidth * displayScale,
					height: frameHeight * displayScale,
					maxWidth: "none",
				}}
			/>
			{label && (
				<span className="absolute bottom-2 left-2 rounded-control bg-black/55 px-2 py-[5px] text-mono-xs leading-none text-[oklch(0.92_0.005_80)]">
					{label}
				</span>
			)}
		</div>
	);
}

/**
 * The line being spoken, word by word, with the current one lit.
 *
 * Only this line is split into words. The reference episode has 8,824 of
 * them, and a span each would put the whole transcript's worth in the DOM to
 * light up one; every other line stays a single text node.
 *
 * The words are the transcript's own, so on the rare line where a word
 * straddles a turn boundary this shows the word-joined text rather than
 * `turn.text`. Measured on the reference episode: 38 of 40 lines are
 * identical either way, and where they differ the words are the more
 * accurate answer, since the turn's text is assembled from them.
 *
 * Plain spans rather than buttons: this sits inside the line's own button,
 * and a button inside a button is invalid. The line stays keyboard-reachable;
 * seeking to an individual word is a pointer shortcut on top of that, not the
 * only way to get there -- the arrows and ↑/↓ already move the playhead.
 */
function SpokenLine({
	turn,
	words,
	at,
	onSeek,
}: {
	turn: Turn;
	words: Word[];
	/** The playhead, from `timeupdate`, which browsers fire about four times a
	 * second. Measured over nine seconds of the reference episode: 15 of the
	 * 20 words spoken were lit, so the highlight follows the line and steps
	 * over the occasional short word.
	 *
	 * A `requestAnimationFrame` loop reading `video.currentTime` is the
	 * obvious way to close that gap and measurably made it worse -- 7 words
	 * of the same 20. The editor manages about 4fps while playing a cropped
	 * shot (21 frames in 9s, 95th-percentile frame gap 1.0s), because that
	 * decodes a second 1080p stream of the same recording alongside the
	 * first. Asking for frames that aren't coming, and re-rendering to ask,
	 * only took time from the thread that owed them. The cadence here is a
	 * symptom of that; see docs/STATUS.md. */
	at: number;
	onSeek: (t: number) => void;
}) {
	const [from, to] = useMemo(() => wordSlice(words, turn.start, turn.end), [words, turn.start, turn.end]);
	// Bounded to this line, so where two people overlap a line never lights up
	// a word from the other one's.
	const current = wordAt(words, at, from, to);
	if (from >= to) return turn.text;

	return (
		<>
			{words.slice(from, to).map((word, i) => (
				<Fragment key={from + i}>
					{i > 0 && " "}
					<span
						onClick={(e) => {
							// The line's own click would seek to its start, which is
							// the opposite of asking for this word.
							e.stopPropagation();
							onSeek(word.start);
						}}
						// The wash alone is 9% accent, which is right for a drop zone
						// and too quiet for the one word you are meant to be reading.
						// Accent ink carries it; both tokens already exist.
						className={`cursor-text rounded-[3px] ${
							from + i === current ? "bg-accent-wash font-medium text-accent-text" : ""
						}`}
					>
						{word.text.trim()}
					</span>
				</Fragment>
			))}
		</>
	);
}

/** How far one press of a nudge arrow moves the crop, as a fraction of its
 * own size -- small enough that several presses feel like fine adjustment,
 * not a jump. */
const NUDGE_STEP = 0.05;

/**
 * What's selected: who it frames, its exact times (editable), split and
 * go-wide, and a small manual crop nudge for when the automatic framing is
 * close but not quite right. Everything here acts on `region` through the
 * callbacks; undo integration lives with them in EditorView.
 */
function RegionInspector({
	region,
	label,
	canSplit,
	duration,
	people,
	nameOf,
	onSplit,
	onGoWide,
	onSetTimes,
	onSetCropNudge,
	onSetPeople,
}: {
	region: FramingRegion;
	label: string;
	canSplit: boolean;
	duration: number;
	/** Everyone the pipeline found on camera, for the who's-on-screen picker
	 * (EDGE_CASES.md C4) -- not everyone in the cast, since there's no crop
	 * to show for a voice nobody ever saw. */
	people: Person[];
	nameOf: (personId: number) => string;
	onSplit: () => void;
	onGoWide: () => void;
	onSetTimes: (start: number, end: number) => void;
	onSetCropNudge: (nudge: { x: number; y: number }) => void;
	onSetPeople: (personIds: number[]) => void;
}) {
	// Rejecting a bad edit used to mean silently doing nothing: the field kept
	// showing whatever was typed, with no sign the edit didn't take, and
	// start >= end wasn't rejected at all -- just silently absorbed by
	// resizeRegion's own clamps into something that could match neither typed
	// value. `revert` resets the one field actually being edited back to its
	// last real value; the other one is left alone; either way the reason
	// shows underneath so this doesn't just look like the field ignored input.
	const [invalidReason, setInvalidReason] = useState<string | null>(null);

	function commitTimes(rawStart: string, rawEnd: string, revert: () => void) {
		const start = parseTimecode(rawStart);
		const end = parseTimecode(rawEnd);
		if (start === undefined || end === undefined) {
			setInvalidReason("Times look like 1:23.4, not whatever that was.");
			revert();
			return;
		}
		if (start >= end) {
			setInvalidReason("Start has to be before end.");
			revert();
			return;
		}
		setInvalidReason(null);
		onSetTimes(Math.max(0, start), Math.min(duration, end));
	}

	const nudge = region.cropNudge ?? { x: 0, y: 0 };
	function nudgeBy(dx: number, dy: number) {
		const clamp = (v: number) => Math.max(-MAX_CROP_NUDGE, Math.min(MAX_CROP_NUDGE, v));
		onSetCropNudge({ x: clamp(nudge.x + dx), y: clamp(nudge.y + dy) });
	}
	const nudged = nudge.x !== 0 || nudge.y !== 0;

	/** EDGE_CASES.md C4: toggling someone in or out of the shot, rather than
	 * only ever "+ Close-up" (one person) or "+ Both on screen" (whoever's
	 * nearest in time) picking for you. Deselecting the last person is a
	 * no-op -- "Go wide here" is the control for clearing a shot entirely,
	 * so this never has to decide what a zero-person region would mean. */
	function togglePerson(id: number) {
		const on = region.personIds.includes(id);
		const next = on ? region.personIds.filter((p) => p !== id) : [...region.personIds, id];
		if (next.length === 0) return;
		onSetPeople(next);
	}

	const timeField = (
		key: string,
		value: number,
		title: string,
		commit: (raw: string, revert: () => void) => void,
	) => (
		<input
			key={key}
			type="text"
			defaultValue={formatTime(value, true)}
			title={title}
			onFocus={() => setInvalidReason(null)}
			onBlur={(e) => {
				const field = e.currentTarget;
				commit(field.value, () => {
					field.value = formatTime(value, true);
				});
			}}
			onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
			className={`w-[70px] rounded-chip border bg-well px-1.5 py-[5px] text-center font-mono text-mono-sm leading-none text-text outline-none focus:border-accent-edge ${
				invalidReason ? "border-warn" : "border-line"
			}`}
		/>
	);

	return (
		<>
			<span className="max-w-[160px] truncate rounded-chip border border-accent-edge bg-raised px-2 py-[5px] font-mono text-label leading-none font-medium tracking-[0.04em] text-text uppercase">
				{label}
			</span>
			<span className="flex items-center gap-1">
				{timeField(`${region.id}-start-${region.start}`, region.start, "Start. Type a new time and press Enter.", (raw, revert) =>
					commitTimes(raw, formatTime(region.end, true), revert),
				)}
				<span className="text-text3">–</span>
				{timeField(`${region.id}-end-${region.end}`, region.end, "End. Type a new time and press Enter.", (raw, revert) =>
					commitTimes(formatTime(region.start, true), raw, revert),
				)}
			</span>
			{invalidReason && <span className="text-fine text-warn">{invalidReason}</span>}
			<span className="flex gap-1.5" title="Who's on screen in this shot.">
				{orderBySeat(
					people.map((p) => p.id),
					people,
				).map((id) => {
					const on = region.personIds.includes(id);
					const seat = people.findIndex((p) => p.id === id);
					return (
						<button
							key={id}
							type="button"
							onClick={() => togglePerson(id)}
							aria-pressed={on}
							className={`inline-flex items-center gap-[7px] rounded-control border px-[11px] py-2 text-mono-sm leading-none font-medium ${
								on ? "border-accent-edge bg-raised text-text" : "border-line text-text3"
							}`}
						>
							<span className={`h-2 w-2 rounded-full ${SPEAKER_DOT[seat % SPEAKER_DOT.length]}`} />
							{nameOf(id)}
						</button>
					);
				})}
			</span>
			<Button size="sm" variant="quiet" onClick={onSplit} disabled={!canSplit} title="Split this shot at the playhead (S)">
				Split
			</Button>
			<Button size="sm" variant="quiet" onClick={onGoWide} title="Make this stretch wide (Delete)">
				Go wide
			</Button>
			{/* Fine adjustment, sized like fine adjustment: one 4-way pad. */}
			<span
				className="grid shrink-0 grid-cols-[repeat(3,15px)] grid-rows-[repeat(3,15px)] gap-px text-text2"
				title="Nudge the crop. Shifts the automatic framing without changing who it frames."
			>
				{(
					[
						[null, null],
						[0, -NUDGE_STEP, "up", "Nudge up"],
						[null, null],
						[-NUDGE_STEP, 0, "left", "Nudge left"],
						"centre",
						[NUDGE_STEP, 0, "right", "Nudge right"],
						[null, null],
						[0, NUDGE_STEP, "down", "Nudge down"],
						[null, null],
					] as const
				).map((cell, i) =>
					cell === "centre" ? (
						<span key={i} className="flex items-center justify-center">
							<span className={`h-1 w-1 rounded-full ${nudged ? "bg-accent" : "bg-text3"}`} />
						</span>
					) : cell[0] === null ? (
						<span key={i} />
					) : (
						<button
							key={i}
							type="button"
							aria-label={cell[3]}
							onClick={() => nudgeBy(cell[0], cell[1])}
							className="flex items-center justify-center rounded-chip border border-line bg-raised hover:bg-control"
						>
							<Triangle direction={cell[2]} size={4} />
						</button>
					),
				)}
			</span>
			{nudged && (
				<Button size="sm" variant="ghost" onClick={() => onSetCropNudge({ x: 0, y: 0 })}>
					Reset crop
				</Button>
			)}
		</>
	);
}

export function EditorView({
	videoUrl,
	jobId,
	turns,
	words,
	overlapWindows,
	faces,
	cast,
	onCastChange,
	health,
	regions,
	onRegionsChange,
	captionsEnabled,
	onCaptionsChange,
	missingRecording,
	onRelink,
	trimDeadAirEnabled,
	onTrimDeadAirChange,
	framingStyle,
	onFramingStyleChange,
	onPublish,
}: {
	/** Playable directly -- a fresh upload's object URL, or (a resumed
	 * session, a reopened saved episode) the server's own `/jobs/{id}/media`.
	 * Owned by App, which knows which one it has. */
	videoUrl: string;
	/** The `/process` job this recording ran as -- still good for fetching the
	 * waveform and timeline thumbnails, which (unlike faces) aren't embedded
	 * in the processing result itself. */
	jobId: string;
	turns: Turn[];
	/** Word timings, so a dragged shot edge can snap between words. */
	words: Word[];
	overlapWindows: OverlapWindow[];
	faces: DetectFacesResponse;
	cast: CastResult;
	/** Rename a person after the cast screen. Names reach the transcript, the
	 * lane labels, the shot chips and the export's decision log, and until
	 * this existed a name set once could never be corrected. */
	onCastChange: (cast: CastResult) => void;
	health: Health | null;
	/** Owned by App, so a trip to the publish screen and back keeps them. */
	regions: FramingRegion[];
	onRegionsChange: React.Dispatch<React.SetStateAction<FramingRegion[]>>;
	/** Shown here; chosen on the publish screen. */
	captionsEnabled: boolean;
	onCaptionsChange: (on: boolean) => void;
	/** Where the recording was when this project was saved, when it isn't
	 * there now. Shown so the file being asked for is named, not guessed at. */
	missingRecording?: string | null;
	/** Ask the user for the recording. Absent in a plain browser, which has
	 * no way to hand the service a path to link to. */
	onRelink?: () => void;
	trimDeadAirEnabled: boolean;
	onTrimDeadAirChange: (enabled: boolean) => void;
	/** Owned by App, same reasoning as regions: survives a trip to the
	 * publish screen, and resets to the default on a fresh cast confirm. */
	framingStyle: FramingStyle;
	onFramingStyleChange: (style: FramingStyle) => void;
	onPublish: (duration: number) => void;
}) {
	const captionsAvailable = health?.captions ?? true;
	const videoRef = useRef<HTMLVideoElement>(null);
	const [frameRef, available] = useElementSize();

	const suggested = useMemo(
		() => suggestRegions(turns, overlapWindows, cast.speakerToPerson, faces.people, framingStyle),
		[turns, overlapWindows, cast.speakerToPerson, faces.people, framingStyle],
	);

	// The style control's own change handler: unlike "Reset to suggested"
	// (a deliberate full reset the editor explicitly asks for), switching
	// style should never discard a shot the editor made -- see
	// reconcileWithStyle's own comment for why this isn't just `edit(suggested)`.
	function changeFramingStyle(style: FramingStyle) {
		onFramingStyleChange(style);
		edit(reconcileWithStyle(regions, turns, overlapWindows, cast.speakerToPerson, faces.people, style));
	}
	// Lines worth a second look: no face to frame, or talking over someone
	// else. The transcript already marks these; this is the same test, kept
	// as start times so the playhead can step between them in order.
	const flaggedTurnStarts = useMemo(
		() =>
			turns
				.filter(
					(t) =>
						cast.speakerToPerson[t.speaker] === undefined || overlapFor(overlapWindows, t.start, t.end),
				)
				.map((t) => t.start),
		[turns, overlapWindows, cast.speakerToPerson],
	);
	const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
	const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
	const [currentTime, setCurrentTime] = useState(0);
	const [playing, setPlaying] = useState(false);
	// server/jobs/ has no eviction policy (see STATUS.md's Known
	// limitations), so a saved episode's media can be gone by the time it's
	// reopened. Without this, that's a black rectangle where the video
	// should be and no indication anything is wrong.
	//
	// Tracks *which* url errored rather than a plain boolean, so a new
	// videoUrl (a different episode) clears the error for free by no longer
	// matching -- setting a plain boolean back to false would mean resetting
	// it inside the effect below, which runs after render rather than during
	// it and costs an extra render pass for no visible benefit.
	const [erroredUrl, setErroredUrl] = useState<string | null>(null);
	const mediaError = erroredUrl !== null && erroredUrl === videoUrl;
	// Until the file's metadata loads, the last turn is the best length we
	// have; the video's own duration is authoritative once it arrives.
	const [duration, setDuration] = useState(() => Math.max(0, ...turns.map((t) => t.end)));
	const [rate, setRate] = useState(1);
	// null while the whole episode is on screen, so the timeline keeps fitting
	// when the file's real length arrives.
	const [zoomed, setZoomed] = useState<TimeSpan | null>(null);
	const [showSpeakerLanes, setShowSpeakerLanes] = useState(true);
	const [explainTrim, setExplainTrim] = useState(false);
	// Built once per episode, not per frame: 8,824 words on the reference
	// recording, and this runs against every `timeupdate`.
	const captionCues = useMemo(() => buildCaptionCues(words), [words]);
	/** The line being spoken now. Distinct from `targetTurnIndex`, which
	 * prefers the selection: that is what "+ Close-up" should act on, but not
	 * what the transcript should be following. */
	const playingTurn = turns.findIndex((t) => t.start <= currentTime && currentTime < t.end);
	const playingRef = useRef<HTMLButtonElement>(null);

	// Keep the spoken line on screen. `block: "nearest"` only scrolls when it
	// has gone out of view, so reading ahead isn't yanked back on every line,
	// and it fires on the line changing rather than on every timeupdate.
	useEffect(() => {
		playingRef.current?.scrollIntoView({ block: "nearest" });
	}, [playingTurn]);
	const view = zoomed ?? { start: 0, end: duration };
	// Undo covers framing edits. It lives with the editor, so it starts fresh
	// after a trip to the publish screen.
	const [history, setHistory] = useState<{ past: FramingRegion[][]; future: FramingRegion[][] }>({
		past: [],
		future: [],
	});
	// The regions as they were when a drag began. They go onto the history at
	// the drag's first move, so a whole drag is one undo step and a click on a
	// handle that doesn't move it is none.
	const dragStart = useRef<FramingRegion[] | null>(null);

	// Fetched once, not polled: both are computed during /process and don't
	// change afterward. Missing either just means the timeline shows less --
	// no waveform bars, no overview thumbnails -- rather than an error, since
	// neither is needed to edit.
	const [waveform, setWaveform] = useState<number[] | null>(null);
	const [thumbnailCount, setThumbnailCount] = useState(0);
	useEffect(() => {
		let cancelled = false;
		getWaveform(jobId)
			.then((peaks) => {
				if (!cancelled) setWaveform(peaks);
			})
			.catch(() => {});
		getProgress(jobId)
			.then((p) => {
				if (!cancelled) setThumbnailCount(p.thumbnailCount);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [jobId]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		const onTime = () => {
			setCurrentTime(video.currentTime);
			followTo(video.currentTime);
		};
		const onMeta = () => {
			if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
		};
		const onPlay = () => setPlaying(true);
		const onPause = () => setPlaying(false);
		const onRate = () => setRate(video.playbackRate);
		const onError = () => setErroredUrl(videoUrl);
		video.addEventListener("timeupdate", onTime);
		video.addEventListener("loadedmetadata", onMeta);
		video.addEventListener("play", onPlay);
		video.addEventListener("pause", onPause);
		video.addEventListener("ratechange", onRate);
		video.addEventListener("error", onError);
		return () => {
			video.removeEventListener("timeupdate", onTime);
			video.removeEventListener("loadedmetadata", onMeta);
			video.removeEventListener("play", onPlay);
			video.removeEventListener("pause", onPause);
			video.removeEventListener("ratechange", onRate);
			video.removeEventListener("error", onError);
		};
	}, [videoUrl]);

	const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
	useEffect(() => {
		keyHandler.current = handleKey;
	});
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => keyHandler.current(e);
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	function nameOf(personId: number | null): string {
		if (personId === null) return "Nobody";
		return cast.names[personId] || `Person ${personId + 1}`;
	}

	/** Who spoke a turn: their face's name, or failing that whatever the
	 * editor called a voice we never saw on camera. */
	/** The colour that stands for whoever this voice belongs to.
	 *
	 * Keyed to the person, not the voice. Diarisation routinely splits one
	 * person into several voices -- the reference episode is six voices for
	 * four people -- so colouring by voice gave the same human two colours in
	 * the timeline and two dot colours in the transcript, which reads as two
	 * different people. Falls back to the voice's own id only for a voice no
	 * face was ever matched to, where there is no person to key on. */
	function colourOfSpeaker(speaker: number): string {
		const personId = cast.speakerToPerson[speaker];
		const seat = personId === undefined ? -1 : faces.people.findIndex((p) => p.id === personId);
		const index = seat >= 0 ? seat : faces.people.length + speaker;
		return SPEAKER_DOT[index % SPEAKER_DOT.length];
	}

	/**
	 * One lane per person, not per voice.
	 *
	 * The same split that gave one person two colours also gave them two
	 * lanes, labelled with the same name twice -- on the reference episode,
	 * "Person 1" and "Person 2" each appeared twice in a list of six. A voice
	 * is a thing the pipeline found; a person is what an editor is looking
	 * for, and the lanes are read as "who is talking". A voice no face was
	 * matched to keeps its own lane, because there is no person to fold it
	 * into.
	 */
	const speakerLanes = useMemo(() => {
		const voices = [...new Set(turns.map((t) => t.speaker))].sort((a, b) => a - b);
		const byPerson = new Map<number, number[]>();
		const unmatched: number[] = [];
		for (const voice of voices) {
			const personId = cast.speakerToPerson[voice];
			if (personId === undefined) unmatched.push(voice);
			else byPerson.set(personId, [...(byPerson.get(personId) ?? []), voice]);
		}
		// `nameOf`/`nameOfSpeaker`/`colourOfSpeaker` say the same things, but
		// they are rebuilt every render, so depending on them would defeat this
		// memo -- and listing them would hide what it actually depends on,
		// which is `cast` and the people. Same rules, read straight from those.
		const people = faces.people;
		const colourFor = (personId: number | null, voice: number) => {
			const seat = personId === null ? -1 : people.findIndex((p) => p.id === personId);
			return SPEAKER_DOT[(seat >= 0 ? seat : people.length + voice) % SPEAKER_DOT.length];
		};
		return [
			...orderBySeat([...byPerson.keys()], people).map((personId) => ({
				key: `person-${personId}`,
				personId,
				name: cast.names[personId] || `Person ${personId + 1}`,
				colour: colourFor(personId, byPerson.get(personId)![0]),
				voices: byPerson.get(personId)!,
			})),
			...unmatched.map((voice) => ({
				key: `voice-${voice}`,
				personId: null,
				name: cast.voiceNames[voice] || "Nobody",
				colour: colourFor(null, voice),
				voices: [voice],
			})),
		];
	}, [turns, cast, faces.people]);

	function nameOfSpeaker(speaker: number): string {
		const personId = cast.speakerToPerson[speaker];
		if (personId !== undefined) return nameOf(personId);
		return cast.voiceNames[speaker] || "Nobody";
	}

	function speakerName(turn: Turn): string {
		return nameOfSpeaker(turn.speaker);
	}

	/** Page the timeline so `t` is on screen, if it's zoomed in. Called wherever
	 * the playhead moves, but not when the editor scrolls away from it on purpose. */
	function followTo(t: number) {
		const length = videoRef.current?.duration;
		setZoomed((z) => (z ? reveal(z, t, Number.isFinite(length) && length ? length : Infinity) : z));
	}

	function seek(t: number) {
		const video = videoRef.current;
		setCurrentTime(t);
		followTo(t);
		if (video) video.currentTime = t;
	}

	function selectTurn(index: number) {
		setSelectedTurn(index);
		seek(turns[index].start);
		const covering = regionAt(regions, turns[index].start + 0.01);
		setSelectedRegionId(covering?.id ?? null);
	}

	function togglePlay() {
		const video = videoRef.current;
		if (!video) return;
		if (video.paused) {
			video.playbackRate = 1;
			void video.play();
		} else video.pause();
	}

	/** The live position: the currentTime state trails playback by up to a quarter second. */
	function now(): number {
		return videoRef.current?.currentTime ?? currentTime;
	}

	function seekFromKeys(t: number) {
		// Otherwise "+ Close-up" would keep acting on a transcript line left behind.
		setSelectedTurn(null);
		seek(Math.max(0, Math.min(duration, t)));
	}

	/** Takes a function as well, so key repeats that land before a re-render
	 * each build on the last instead of all starting from the same view. */
	function changeView(next: TimeSpan | ((current: TimeSpan) => TimeSpan)) {
		setZoomed((z) => {
			const v = typeof next === "function" ? next(z ?? { start: 0, end: duration }) : next;
			return v.start <= 0 && v.end >= duration ? null : v;
		});
	}

	/** Zoom around the playhead when it's on screen, else around the middle. */
	function zoomBy(factor: number) {
		const t = now();
		changeView((v) => {
			const anchor = t >= v.start && t <= v.end ? t : (v.start + v.end) / 2;
			return zoomView(v, factor, anchor, duration);
		});
	}

	function jumpToShotEdge(direction: 1 | -1) {
		const edges = [...new Set([0, duration, ...regions.flatMap((r) => [r.start, r.end])])].sort(
			(a, b) => a - b,
		);
		const t = stepToEdge(edges, now(), direction);
		if (t === undefined) return;
		seekFromKeys(t);
		setSelectedRegionId(regionAt(regions, t)?.id ?? null);
	}

	/** Step the playhead to the next (or previous) line the transcript has
	 * flagged, in order -- the keyboard route to the same list "N to review"
	 * counts. */
	function jumpToFlaggedTurn(direction: 1 | -1) {
		const t = stepToEdge(flaggedTurnStarts, now(), direction);
		if (t === undefined) return;
		const index = turns.findIndex((turn) => turn.start === t);
		if (index >= 0) selectTurn(index);
	}

	/** Apply a framing change as one undo step. */
	function edit(next: FramingRegion[]) {
		// regions.ts signals a no-op (e.g. splitRegion/resizeRegion given an
		// out-of-range point) by returning the same array reference -- skip it
		// rather than pushing a dead entry onto the undo stack.
		if (next === regions) return;
		setHistory((h) => ({ past: [...h.past, regions].slice(-HISTORY_LIMIT), future: [] }));
		onRegionsChange(next);
	}

	function resize(id: string, edge: "start" | "end", to: number) {
		const before = dragStart.current;
		const was = before?.find((r) => r.id === id);
		const after = before && resizeRegion(before, id, edge, to, duration).find((r) => r.id === id);
		// Recorded only once the edge really moves: a handle pushed against its
		// limit changes nothing and shouldn't leave an undo step that does nothing.
		if (before && was && after && (after.start !== was.start || after.end !== was.end)) {
			dragStart.current = null;
			setHistory((h) => ({ past: [...h.past, before].slice(-HISTORY_LIMIT), future: [] }));
		}
		onRegionsChange((rs) => resizeRegion(rs, id, edge, to, duration));
	}

	function undo() {
		const previous = history.past.at(-1);
		if (!previous) return;
		dragStart.current = null;
		setHistory({ past: history.past.slice(0, -1), future: [regions, ...history.future] });
		onRegionsChange(previous);
	}

	function redo() {
		const [next, ...rest] = history.future;
		if (!next) return;
		dragStart.current = null;
		setHistory({ past: [...history.past, regions], future: rest });
		onRegionsChange(next);
	}

	function handleKey(e: KeyboardEvent) {
		if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
		const mod = e.metaKey || e.ctrlKey;
		if (mod && e.key.toLowerCase() === "z") {
			e.preventDefault();
			if (e.shiftKey) redo();
			else undo();
			return;
		}
		if (mod && e.key.toLowerCase() === "y") {
			e.preventDefault();
			redo();
			return;
		}
		if (mod || e.altKey) return;

		const video = videoRef.current;
		switch (e.key) {
			case " ":
				togglePlay();
				break;
			case "k":
			case "K":
				video?.pause();
				break;
			case "l":
			case "L":
				if (!video) break;
				if (video.paused) togglePlay();
				else video.playbackRate = Math.min(video.playbackRate * 2, 4);
				break;
			case "j":
			case "J":
				seekFromKeys(now() - 5);
				break;
			case "ArrowLeft":
			case "ArrowRight": {
				const step = e.shiftKey ? 10 : 1;
				seekFromKeys(now() + (e.key === "ArrowRight" ? step : -step));
				break;
			}
			case "ArrowUp":
			case "ArrowDown":
				jumpToShotEdge(e.key === "ArrowDown" ? 1 : -1);
				break;
			case "=":
			case "+":
				zoomBy(0.5);
				break;
			case "-":
			case "_":
				zoomBy(2);
				break;
			case "Z":
				setZoomed(null);
				break;
			case "s":
			case "S":
				splitHere();
				break;
			case "Delete":
			case "Backspace":
				if (selectedRegion) goWide(selectedRegion.id);
				break;
			case "Escape":
				setSelectedRegionId(null);
				break;
			case "Tab":
				// Let Tab move focus normally away from a button/link -- only treat
				// it as the review-stepper shortcut when nothing focusable has it.
				if (e.target instanceof Element && e.target.closest("button, a")) return;
				jumpToFlaggedTurn(e.shiftKey ? -1 : 1);
				break;
			default:
				return;
		}
		e.preventDefault();
	}

	const framing = resolveFraming(regions, faces.people, currentTime);

	// An audio-only file reports a 0x0 frame; without a fallback the stage
	// collapses to nothing.
	const sourceAspect =
		faces.frameWidth > 0 && faces.frameHeight > 0 ? faces.frameWidth / faces.frameHeight : 16 / 9;
	const stageSize = fitBox(sourceAspect, available.width, available.height);
	/** The panes this shot renders into, in source pixels -- the crop is
	 * computed against these, so it is the same crop ffmpeg produces. */
	const panes = exportPanes(framing.kind === "wide" ? 1 : framing.subjects.length, faces.frameWidth, faces.frameHeight);
	/** Source pixels to on-screen pixels, for positioning only. */
	const displayScale = faces.frameWidth > 0 ? stageSize.width / faces.frameWidth : 0;

	// What "+ Close-up" / "+ Both on screen" would act on: the selected turn,
	// or whatever turn the playhead is sitting in.
	const targetTurnIndex =
		selectedTurn ?? turns.findIndex((t) => t.start <= currentTime && currentTime < t.end);
	const targetTurn = targetTurnIndex >= 0 ? turns[targetTurnIndex] : undefined;
	const targetPerson = targetTurn ? cast.speakerToPerson[targetTurn.speaker] : undefined;

	function addCloseUp() {
		if (!targetTurn || targetPerson === undefined) return;
		edit(addRegion(regions, targetTurn.start, targetTurn.end, "zoom", [targetPerson]));
	}

	function addBothOnScreen() {
		if (!targetTurn) return;
		const other = otherSpeakerNear(turns, cast.speakerToPerson, targetTurn.start, targetPerson);
		const ids = [targetPerson, other].filter((id): id is number => id !== undefined);
		if (ids.length < 2) return;
		edit(addRegion(regions, targetTurn.start, targetTurn.end, "split", orderBySeat(ids, faces.people)));
	}

	function goWide(id: string) {
		edit(regions.filter((r) => r.id !== id));
		setSelectedRegionId(null);
	}

	function splitHere() {
		if (!selectedRegion) return;
		edit(splitRegion(regions, selectedRegion.id, now()));
	}

	/** Typed exact times from the inspector, as one undo step covering both
	 * edges -- the same model a drag uses, just without a drag. */
	function setRegionTimes(id: string, start: number, end: number) {
		const withStart = resizeRegion(regions, id, "start", start, duration);
		edit(resizeRegion(withStart, id, "end", end, duration));
	}

	function setCropNudge(id: string, nudge: { x: number; y: number }) {
		edit(regions.map((r) => (r.id === id ? { ...r, cropNudge: nudge, source: "user" } : r)));
	}

	/** EDGE_CASES.md C4: the who's-on-screen picker changing a shot's people
	 * directly, rather than only ever via "+ Close-up" or "+ Both on screen".
	 * Layout follows the count -- one person is a close-up, two or more is
	 * both-on-screen -- the same rule addBothOnScreen and suggestRegions
	 * already use, just derived here instead of chosen up front. Seat order
	 * (rule 7), not floor-holder order (rule 3/C2): that ordering is specific
	 * to the automatic suggestion, not a hand edit with no turn to read a
	 * "who was already talking" answer from. */
	function setRegionPeople(id: string, personIds: number[]) {
		const ordered = orderBySeat(personIds, faces.people);
		edit(
			regions.map((r) =>
				r.id === id ? { ...r, personIds: ordered, layout: ordered.length === 1 ? "zoom" : "split", source: "user" } : r,
			),
		);
	}

	/** One clause saying what was done here and why, in the words the user
	 * would use. Never announces that something was automatic -- it shows the
	 * result and the reason, and the override does the reassuring. */
	function reasonFor(index: number): string {
		const turn = turns[index];
		const region = regionAt(regions, turn.start + 0.01);

		if (!region) {
			if (cast.speakerToPerson[turn.speaker] === undefined) {
				const voiceName = cast.voiceNames[turn.speaker];
				return voiceName
					? `We never saw ${voiceName} on camera, so we stayed wide.`
					: "We couldn't see a face for this voice, so we stayed wide.";
			}
			return "This stretch is wide.";
		}
		if (region.source === "user") {
			return region.layout === "split"
				? `You put ${region.personIds.map((id) => nameOf(id)).join(" and ")} on screen together here.`
				: `You set this to close on ${nameOf(region.personIds[0])}.`;
		}
		if (region.layout === "split") {
			return `${region.personIds.map((id) => nameOf(id)).join(" and ")} talk over each other here, so we show both.`;
		}
		return `${speakerName(turn)} is talking alone here, so we cut in close.`;
	}

	/** The colour of the decision a line's reason describes, as in the timeline. */
	function reasonSwatch(index: number): string {
		const turn = turns[index];
		const region = regionAt(regions, turn.start + 0.01);
		if (!region) return cast.speakerToPerson[turn.speaker] === undefined ? "bg-warn" : "bg-r-wide";
		if (region.source === "user") return "bg-r-mine";
		return region.layout === "split" ? "bg-r-both" : "bg-r-close";
	}

	const selectedRegion = regions.find((r) => r.id === selectedRegionId) ?? null;
	const reviewCount = flaggedTurnStarts.length;

	const framingLabel =
		framing.kind === "wide"
			? "Wide"
			: framing.kind === "split"
				? framing.subjects.map((s) => nameOf(s.personId)).join(" + ")
				: `Close · ${nameOf(framing.subjects[0].personId)}`;
	const cropped = framing.kind !== "wide";

	const pill = "rounded-control bg-black/55 px-2 py-[5px] font-mono text-mono-xs leading-none text-[oklch(0.92_0.005_80)]";

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-bg">
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<aside className="flex w-[404px] shrink-0 flex-col border-r border-line bg-panel">
					<div className="flex shrink-0 items-center gap-[9px] border-b border-line px-[17px] py-[13px]">
						<SectionLabel>Transcript</SectionLabel>
						{reviewCount > 0 && (
							<span className="ml-auto flex items-center gap-[9px]">
								<span className="inline-flex items-center gap-[7px] font-mono text-mono-xs leading-none text-text3">
									<span className="h-2 w-2 rounded-[2px] bg-warn" />
									{reviewCount} to review
								</span>
								{([-1, 1] as const).map((direction) => (
									<button
										key={direction}
										type="button"
										onClick={() => jumpToFlaggedTurn(direction)}
										aria-label={direction < 0 ? "Previous line to review" : "Next line to review"}
										title={direction < 0 ? "Previous line to review (Shift Tab)" : "Next line to review (Tab)"}
										className="flex h-6 w-6 items-center justify-center rounded-control border border-line bg-raised text-text2 hover:bg-control"
									>
										<Triangle direction={direction < 0 ? "left" : "right"} size={5} />
									</button>
								))}
							</span>
						)}
					</div>
					<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
						{turns.map((t, i) => {
							const overlap = overlapFor(overlapWindows, t.start, t.end);
							const assigned = cast.speakerToPerson[t.speaker] ?? null;
							const selected = i === selectedTurn;
							const spoken = i === playingTurn;
							const needsAttention = assigned === null;
							// The left rail carries state: selection over overlap over a missing face.
							const rail = selected
								? "border-l-accent"
								: overlap
									? "border-l-r-both"
									: needsAttention
										? "border-l-warn"
										: "border-l-transparent";
							return (
								<button
									type="button"
									key={i}
									ref={spoken ? playingRef : undefined}
									onClick={() => selectTurn(i)}
									className={`flex flex-col border-l-[3px] px-[17px] text-left ${rail} ${
										selected ? "gap-[7px] bg-sel pt-3 pb-[13px]" : "gap-1 py-[10px]"
									}`}
								>
									<span className="flex flex-wrap items-center gap-[7px]">
										<span className={`h-[7px] w-[7px] shrink-0 rounded-full ${colourOfSpeaker(t.speaker)}`} />
										<span className={`text-meta leading-none font-semibold ${selected ? "text-text" : "text-text2"}`}>
											{speakerName(t)}
										</span>
										<span className="font-mono text-mono-xs leading-none text-text3">
											{formatTime(t.start)} – {formatTime(t.end)}
										</span>
										{(needsAttention || overlap) && (
											<span className="ml-auto flex gap-1">
												{needsAttention && (
													<span className="rounded-chip bg-warn-bg px-[7px] py-1 font-mono text-label leading-none font-medium tracking-[0.04em] text-warn">
														NO FACE
													</span>
												)}
												{overlap && (
													<span className="rounded-chip bg-warn-bg px-[7px] py-1 font-mono text-label leading-none font-medium tracking-[0.04em] text-warn">
														TALKING OVER
													</span>
												)}
											</span>
										)}
									</span>
									<span className={`text-pretty ${selected ? "text-body text-text" : "text-ui text-text3"}`}>
										{spoken ? <SpokenLine turn={t} words={words} at={currentTime} onSeek={seek} /> : t.text}
									</span>
									<span className="flex items-center gap-[7px] text-mono-sm text-text3">
										<span className={`h-[9px] w-[9px] shrink-0 rounded-[2px] ${reasonSwatch(i)}`} />
										{reasonFor(i)}
									</span>
								</button>
							);
						})}
					</div>
				</aside>

				<main className="flex min-h-0 flex-1 flex-col gap-[13px] px-5 py-[18px]">
					{/* The stage is sized to the recording's own shape rather than
					    stretched to fill the panel. A flex parent overrides a CSS
					    `aspect-ratio`, so the stage used to be wider than the source:
					    the wide shot was letterboxed inside it, while a close-up --
					    cropped to whatever shape the stage happened to be -- filled it
					    edge to edge. That shape also reached `personCrop`, so the crop
					    on screen was not the crop ffmpeg rendered. */}
					<div ref={frameRef} className="flex min-h-0 flex-1 items-center justify-center">
					<div
						className="relative overflow-hidden rounded-card-lg bg-plate-b"
						style={{ width: stageSize.width, height: stageSize.height }}
					>
						{videoUrl && (
							<video
								ref={videoRef}
								src={videoUrl}
								playsInline
								className={`h-full w-full object-contain ${cropped ? "opacity-0" : ""}`}
							/>
						)}

						{mediaError && (
							<div className="plate-stripes absolute inset-0 flex flex-col items-center justify-center gap-[13px] p-6 text-center">
								<p className="max-w-[380px] text-ui text-plate-ink">
									Couldn't load this recording. The file may have been moved, renamed, or deleted
									since this episode was processed.
								</p>
								{missingRecording && (
									<p className="max-w-[380px] font-mono text-mono-xs break-all text-plate-ink/70">
										{missingRecording}
									</p>
								)}
								{/* Everything else about the episode is here and editable --
								    only the picture is missing -- so this asks for the file
								    rather than sending anyone back to the start. */}
								{onRelink && (
									<Button size="sm" onClick={onRelink}>
										Find the recording…
									</Button>
								)}
							</div>
						)}

						{!mediaError && videoUrl && framing.kind === "zoom" && (
							<div className="absolute inset-0">
								<CroppedVideo
									videoUrl={videoUrl}
									bbox={framing.subjects[0].bbox}
									frameWidth={faces.frameWidth}
									frameHeight={faces.frameHeight}
									pane={panes[0]}
									displayWidth={stageSize.width}
									cropNudge={framing.region.cropNudge}
									driverRef={videoRef}
								/>
							</div>
						)}

						{!mediaError && videoUrl && framing.kind === "split" && (
							<div className="absolute inset-0">
								{framing.subjects.length <= DUO_SPLIT_MAX ? (
									<div className="flex h-full">
										{framing.subjects.map((subject, i) => (
											<div
												key={subject.personId}
												className="h-full flex-1 border-l border-plate-a first:border-l-0"
											>
												<CroppedVideo
													videoUrl={videoUrl}
													bbox={subject.bbox}
													frameWidth={faces.frameWidth}
													frameHeight={faces.frameHeight}
													pane={panes[i]}
													displayWidth={panes[i].width * displayScale}
													label={nameOf(subject.personId)}
													cropNudge={framing.region.cropNudge}
													driverRef={videoRef}
												/>
											</div>
										))}
									</div>
								) : (
									// Three or more: speaker large, everyone else down the side.
									// Splitting 16:9 into N equal columns gives slivers past two.
									<div className="flex h-full">
										<div style={{ width: panes[0].width * displayScale }} className="h-full">
											<CroppedVideo
												videoUrl={videoUrl}
												bbox={framing.subjects[0].bbox}
												frameWidth={faces.frameWidth}
												frameHeight={faces.frameHeight}
												pane={panes[0]}
												displayWidth={panes[0].width * displayScale}
												label={nameOf(framing.subjects[0].personId)}
												cropNudge={framing.region.cropNudge}
												driverRef={videoRef}
											/>
										</div>
										<div className="flex h-full flex-1 flex-col border-l border-plate-a">
											{framing.subjects.slice(1).map((subject, i) => (
												<div
													key={subject.personId}
													className="flex-1 border-t border-plate-a first:border-t-0"
												>
													<CroppedVideo
														videoUrl={videoUrl}
														bbox={subject.bbox}
														frameWidth={faces.frameWidth}
														frameHeight={faces.frameHeight}
														pane={panes[i + 1]}
														displayWidth={panes[i + 1].width * displayScale}
														label={nameOf(subject.personId)}
														cropNudge={framing.region.cropNudge}
														driverRef={videoRef}
													/>
												</div>
											))}
										</div>
									</div>
								)}
							</div>
						)}

						{/* Anything over the plate uses fixed ink: the plate never inverts. */}
						<div className="pointer-events-none absolute top-[14px] left-[14px] flex gap-1.5">
							<span className="rounded-chip bg-accent px-2 py-[5px] font-mono text-label leading-none font-medium tracking-[0.04em] text-on-accent uppercase">
								{framingLabel}
							</span>
							{framing.kind !== "wide" && framing.region.source === "user" && (
								<span className="rounded-chip bg-r-mine px-2 py-[5px] font-mono text-label leading-none font-medium tracking-[0.04em] text-r-mine-ink uppercase">
									Yours
								</span>
							)}
							<span className={pill}>{faces.frameWidth > 0 ? `${faces.frameWidth}×${faces.frameHeight}` : "audio only"}</span>
						</div>
						{/* What the export will burn in, grouped by the same rules
						    (`buildCaptionCues` ports `build_caption_cues`) and placed
						    where `write_ass` puts it: bottom-centre, 7% up from the
						    bottom, 4.5% of frame height. Sized off the stage so it
						    holds at any window size, and shown only when the export
						    would actually produce them. */}
						{captionsEnabled && captionsAvailable && stageSize.height > 0 && (() => {
							const cue = cueAt(captionCues, currentTime);
							if (!cue) return null;
							return (
								<span
									className="pointer-events-none absolute left-1/2 max-w-[86%] -translate-x-1/2 text-center font-semibold text-balance text-white"
									style={{
										bottom: stageSize.height * 0.07,
										fontSize: stageSize.height * 0.045,
										lineHeight: 1.2,
										// `write_ass` draws a 0.3%-of-height outline, not a
										// box; four shadows is the closest CSS equivalent.
										textShadow: Array.from({ length: 4 }, (_, i) => {
											const r = Math.max(1, stageSize.height * 0.003);
											const angle = (i * Math.PI) / 2;
											return `${Math.round(Math.cos(angle) * r)}px ${Math.round(Math.sin(angle) * r)}px 0 #000`;
										}).join(", "),
									}}
								>
									{cue.text}
								</span>
							);
						})()}

						<span className={`pointer-events-none absolute right-[14px] bottom-[14px] ${pill}`}>{formatTime(currentTime)}</span>
					</div>
					</div>

					<div className="flex shrink-0 items-center gap-[13px]">
						<PlayButton playing={playing} onClick={togglePlay} title={`${playing ? "Pause" : "Play"} (Space)`} />
						<span className="font-mono text-mono leading-none text-text2">
							{formatTime(currentTime)} / {formatTime(duration)}
							{rate !== 1 && <span className="ml-2 text-accent-text">{rate}×</span>}
						</span>
						{/* This read as a button and wasn't one: a status line about the
						    export, next to a preview that never drew a caption. Now it
						    toggles, and what it toggles is visible. */}
						<Button
							size="sm"
							variant="quiet"
							className="ml-auto"
							onClick={() => onCaptionsChange(!captionsEnabled)}
							disabled={!captionsAvailable}
							aria-pressed={captionsAvailable && captionsEnabled}
							title={
								captionsAvailable
									? "Show captions here and burn them into the export. Cut from the word timings, so they land where the words do."
									: "This ffmpeg was built without subtitle support, so captions can't be burned in."
							}
						>
							{captionsAvailable ? (captionsEnabled ? "Captions on" : "Captions off") : "No captions"}
						</Button>
					</div>
				</main>
			</div>

			<div className="shrink-0 border-t border-line bg-panel px-5 pt-[14px] pb-3">
				<div className="mb-[11px] flex flex-wrap items-center gap-[10px]">
					<SectionLabel>Framing</SectionLabel>
					<span className="flex gap-[5px]">
						<Button size="sm" onClick={addCloseUp} disabled={targetPerson === undefined}>
							+ {LAYOUT_LABELS.zoom}
						</Button>
						<Button size="sm" onClick={addBothOnScreen} disabled={!targetTurn}>
							+ {LAYOUT_LABELS.split}
						</Button>
						{/* Not built yet, shown rather than hidden, and inert rather than a
						    dashed ghost that reads as broken. No issue link: there is no
						    issue for this yet, and a link to nothing is worse than none. */}
						<Button
							size="sm"
							variant="inert"
							title="Notes on screen: captions for names, terms and links, drawn over the video. Not built yet — it's next after clips."
						>
							+ Note
						</Button>
					</span>
					<span className="ml-auto flex items-center gap-1">
						{/* Named, and with the span it is showing. At full view both
						    "−" and "Show all" are correctly disabled, which left three
						    grey buttons and no hint that the timeline zooms at all --
						    a founder testing session reported zoom and scroll as
						    missing features when both had shipped. */}
						<span className="mr-1 font-mono text-mono-xs leading-none text-text3">
							Zoom · {zoomed ? `${formatTime(view.end - view.start)} shown` : "whole episode"}
						</span>
						<Button
							size="sm"
							variant="quiet"
							onClick={() => setShowSpeakerLanes((on) => !on)}
							aria-pressed={showSpeakerLanes}
							title="Show or hide the lane per speaker under the framing timeline."
						>
							{showSpeakerLanes ? "Hide speakers" : "Show speakers"}
						</Button>
						<Button
							size="sm"
							variant="quiet"
							onClick={() => zoomBy(2)}
							disabled={!zoomed}
							aria-label="Zoom out"
							title="Zoom out (−). Pinch or ⌘-scroll on the timeline works too."
						>
							−
						</Button>
						<Button
							size="sm"
							variant="quiet"
							onClick={() => zoomBy(0.5)}
							disabled={view.end - view.start <= MIN_VIEW_S}
							aria-label="Zoom in"
							title="Zoom in (=). Pinch or ⌘-scroll on the timeline works too."
						>
							+
						</Button>
						<Button size="sm" variant="quiet" onClick={() => setZoomed(null)} disabled={!zoomed} title="Show the whole episode (Shift Z)">
							Show all
						</Button>
						<button type="button" popoverTarget="editor-shortcuts" className="rounded-control border border-line bg-raised px-[11px] py-[7px] text-mono-sm leading-none font-medium text-text2 hover:bg-control">
							Shortcuts
						</button>
						<div
							id="editor-shortcuts"
							popover="auto"
							className="m-auto rounded-card-lg border border-line bg-panel p-[18px] text-text shadow-panel"
						>
							<p className="mb-[13px] text-section font-semibold">Keyboard shortcuts</p>
							<dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
								{SHORTCUTS.map(([keys, what]) => (
									<Fragment key={keys}>
										<dt>
											<kbd className="rounded-chip bg-raised px-1.5 py-0.5 font-mono text-mono-sm text-text2">{keys}</kbd>
										</dt>
										<dd className="text-ui text-text3">{what}</dd>
									</Fragment>
								))}
							</dl>
						</div>
					</span>
					<span className="flex items-center gap-[13px]">
						<span className="flex items-center gap-[5px] text-mono-xs leading-none text-text2">
							<span className="h-[9px] w-[14px] rounded-[2px] bg-r-close" />
							Suggested
						</span>
						<span className="flex items-center gap-[5px] text-mono-xs leading-none text-text2">
							<span className="h-[9px] w-[14px] rounded-[2px] border border-handle bg-r-mine" />
							Yours
						</span>
					</span>
				</div>

				<TimelineTray
					duration={duration}
					view={view}
					regions={regions}
					turns={turns}
					words={words}
					selectedRegionId={selectedRegionId}
					currentTime={currentTime}
					lanes={speakerLanes}
					onRenamePerson={(personId, name) => onCastChange({ ...cast, names: { ...cast.names, [personId]: name } })}
					showSpeakerLanes={showSpeakerLanes}
					nameOf={(id) => nameOf(id)}
					waveform={waveform}
					thumbnailUrls={Array.from({ length: thumbnailCount }, (_, i) => timelineThumbnailUrl(jobId, i))}
					onViewChange={changeView}
					onSelectRegion={setSelectedRegionId}
					onEditStart={() => {
						dragStart.current = regions;
					}}
					onResize={resize}
					onSeek={seek}
				/>
			</div>

			{/* Split in two: what's selected on the left, the episode's own
			    controls on the right, and Export as the one accent action, last. */}
			<div className="relative flex shrink-0 items-center gap-[14px] border-t border-line bg-chrome px-[14px] py-[11px]">
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-[9px]">
					<SectionLabel className="shrink-0">Selected</SectionLabel>
					{selectedRegion ? (
						<RegionInspector
							region={selectedRegion}
							label={
								selectedRegion.layout === "zoom"
									? `Close · ${nameOf(selectedRegion.personIds[0])}`
									: selectedRegion.personIds.map((id) => nameOf(id)).join(" + ")
							}
							canSplit={
								// now(), not currentTime -- currentTime only updates on the
								// video's own timeupdate event, which trails playback by up
								// to a quarter second, so this could show enabled/disabled a
								// beat behind the position splitHere() would actually use.
								now() - selectedRegion.start >= MIN_REGION_S && selectedRegion.end - now() >= MIN_REGION_S
							}
							duration={duration}
							people={faces.people}
							nameOf={nameOf}
							onSplit={splitHere}
							onGoWide={() => goWide(selectedRegion.id)}
							onSetTimes={(start, end) => setRegionTimes(selectedRegion.id, start, end)}
							onSetCropNudge={(nudge) => setCropNudge(selectedRegion.id, nudge)}
							onSetPeople={(personIds) => setRegionPeople(selectedRegion.id, personIds)}
						/>
					) : (
						<span className="text-fine text-text3">
							Nothing yet. Pick a shot on the timeline to move its edges, or a line in the transcript to jump
							there. Edges snap to the nearest word; hold Option to place one freely.
						</span>
					)}
				</div>

				<span className="w-px shrink-0 self-stretch bg-line" />

				<div className="flex shrink-0 items-center gap-[9px]">
					<SectionLabel>Episode</SectionLabel>
					<label
						className="relative inline-flex items-center gap-[5px] rounded-control border border-line bg-raised py-2 pr-6 pl-[11px] text-mono-sm leading-none font-medium text-text2 hover:bg-control"
						title="How much automatic framing this episode gets. Wide only suggests nothing; Gentle cuts only for longer stretches; Dynamic uses every rule. A manual + Close-up or + Both on screen always works, and switching never touches a shot you made."
					>
						Framing:
						<select
							value={framingStyle}
							onChange={(e) => changeFramingStyle(e.target.value as FramingStyle)}
							className="appearance-none bg-transparent font-medium text-text2 outline-none"
						>
							{(Object.keys(FRAMING_STYLE_LABELS) as FramingStyle[]).map((style) => (
								<option key={style} value={style}>
									{FRAMING_STYLE_LABELS[style]}
								</option>
							))}
						</select>
						<span className="pointer-events-none absolute right-[10px] text-text3">
							<Triangle direction="down" size={4} />
						</span>
					</label>
					<button
						type="button"
						role="checkbox"
						aria-checked={trimDeadAirEnabled}
						onClick={() => onTrimDeadAirChange(!trimDeadAirEnabled)}
						title="Cuts long pauses down to a short beat and removes standalone filler words (um, uh). Conservative on purpose -- see docs/FEATURES.md."
						className="inline-flex items-center gap-[9px] rounded-control border border-line bg-raised px-[11px] py-2 text-mono-sm leading-none font-medium text-text2 hover:bg-control"
					>
						<CheckMark checked={trimDeadAirEnabled} size={15} />
						Trim dead air
					</button>
					<button
						type="button"
						onClick={() => setExplainTrim((on) => !on)}
						aria-expanded={explainTrim}
						aria-label="What does trimming dead air do?"
						className="flex h-6 w-6 items-center justify-center rounded-control border border-line bg-raised text-text3 hover:bg-control"
					>
						?
					</button>
					{/* Above the bar rather than in it: this is a sentence, and a
					    sentence in a row of controls either stretches the row or
					    wraps it. Nothing below moves when it opens. */}
					{explainTrim && (
						<p className="absolute right-5 bottom-full z-10 mb-2 w-[420px] rounded-card border border-line bg-raised px-[14px] py-3 text-meta text-pretty text-text2 shadow-lg">
							Cuts a pause longer than a beat down to a beat, and removes standalone filler words —
							um, uh, hmm. Deliberately narrow: words that are only sometimes filler (“like”, “so”,
							“right”) are left alone, because there’s no way to tell one from the other and cutting
							the wrong one removes meaning. Nothing else in the audio is touched.
						</p>
					)}
					<span className="flex gap-1.5">
						<Button size="sm" variant="quiet" onClick={undo} disabled={history.past.length === 0} title="Undo (⌘Z)">
							Undo
						</Button>
						<Button size="sm" variant="quiet" onClick={redo} disabled={history.future.length === 0} title="Redo (⇧⌘Z)">
							Redo
						</Button>
					</span>
					<Button
						variant="ghost"
						onClick={() => {
							edit(suggested);
							setSelectedRegionId(null);
						}}
					>
						Reset to suggested
					</Button>
					<Button variant="primary" onClick={() => onPublish(duration)}>
						Export episode
					</Button>
				</div>
			</div>
		</div>
	);
}
