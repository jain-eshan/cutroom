import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BBox, DetectFacesResponse, Health, OverlapWindow, Turn, Word } from "@/lib/api";
import type { CastResult } from "@/features/faces/CastScreen";
import { personCrop } from "@/lib/faceCrop";
import { TimelineTray } from "@/features/timeline/TimelineTray";
import { LAYOUT_LABELS, type FramingRegion } from "@/features/timeline/types";
import {
	addRegion,
	otherSpeakerNear,
	regionAt,
	resizeRegion,
	resolveFraming,
	suggestRegions,
} from "@/features/timeline/regions";
import {
	MIN_VIEW_S,
	formatTimecode as formatTime,
	reveal,
	stepToEdge,
	zoomView,
	type TimeSpan,
} from "@/features/timeline/timelineView";
import { Logo } from "@/components/Logo";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import type { ThemeMode } from "@/lib/theme";

// Two people get a side-by-side split; three or more get the speaker-focus
// layout instead of N narrow columns. Must match render.py's DUO_SPLIT_MAX
// and SPEAKER_FOCUS_MAIN_FRACTION.
const DUO_SPLIT_MAX = 2;
const SPEAKER_FOCUS_MAIN_FRACTION = 0.68;

// Pane cap is 3 -- see docs/design/handoff README, speaker colour tokens.
const SPEAKER_DOT = ["bg-s1", "bg-s2", "bg-s3"];

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
	["= −", "Zoom the timeline in or out"],
	["Shift Z", "Show the whole episode"],
	["⌘Z", "Undo. With Shift, redo"],
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
	paneWidth,
	paneHeight,
	label,
	driverRef,
}: {
	videoUrl: string;
	bbox: BBox | undefined;
	frameWidth: number;
	frameHeight: number;
	paneWidth: number;
	paneHeight: number;
	label?: string;
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

	if (!bbox || paneWidth === 0 || paneHeight === 0) {
		return <div className="h-full w-full bg-black" />;
	}

	const crop = personCrop(bbox, frameWidth, frameHeight, paneWidth, paneHeight);
	const displayScale = paneWidth / crop.width;

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
				<span className="absolute bottom-1 left-1 rounded-chip bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
					{label}
				</span>
			)}
		</div>
	);
}

export function EditorView({
	file,
	turns,
	words,
	overlapWindows,
	faces,
	cast,
	health,
	regions,
	onRegionsChange,
	captionsEnabled,
	trimDeadAirEnabled,
	onTrimDeadAirChange,
	onPublish,
	themeMode,
	onThemeModeChange,
}: {
	file: File;
	turns: Turn[];
	/** Word timings, so a dragged shot edge can snap between words. */
	words: Word[];
	overlapWindows: OverlapWindow[];
	faces: DetectFacesResponse;
	cast: CastResult;
	health: Health | null;
	/** Owned by App, so a trip to the publish screen and back keeps them. */
	regions: FramingRegion[];
	onRegionsChange: React.Dispatch<React.SetStateAction<FramingRegion[]>>;
	/** Shown here; chosen on the publish screen. */
	captionsEnabled: boolean;
	trimDeadAirEnabled: boolean;
	onTrimDeadAirChange: (enabled: boolean) => void;
	onPublish: (duration: number) => void;
	themeMode: ThemeMode;
	onThemeModeChange: (mode: ThemeMode) => void;
}) {
	const captionsAvailable = health?.captions ?? true;
	// Object URL has to be created *inside* the effect (not derived via useMemo)
	// so StrictMode's mount->cleanup->mount dev-mode cycle recreates a fresh URL
	// each time instead of revoking the one useMemo cached and never remaking.
	const [videoUrl, setVideoUrl] = useState<string | null>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const [stageRef, stageSize] = useElementSize();

	const suggested = useMemo(
		() => suggestRegions(turns, overlapWindows, cast.speakerToPerson),
		[turns, overlapWindows, cast.speakerToPerson],
	);
	const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
	const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
	const [currentTime, setCurrentTime] = useState(0);
	const [playing, setPlaying] = useState(false);
	// Until the file's metadata loads, the last turn is the best length we
	// have; the video's own duration is authoritative once it arrives.
	const [duration, setDuration] = useState(() => Math.max(0, ...turns.map((t) => t.end)));
	const [rate, setRate] = useState(1);
	// null while the whole episode is on screen, so the timeline keeps fitting
	// when the file's real length arrives.
	const [zoomed, setZoomed] = useState<TimeSpan | null>(null);
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

	useEffect(() => {
		const url = URL.createObjectURL(file);
		setVideoUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

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
		video.addEventListener("timeupdate", onTime);
		video.addEventListener("loadedmetadata", onMeta);
		video.addEventListener("play", onPlay);
		video.addEventListener("pause", onPause);
		video.addEventListener("ratechange", onRate);
		return () => {
			video.removeEventListener("timeupdate", onTime);
			video.removeEventListener("loadedmetadata", onMeta);
			video.removeEventListener("play", onPlay);
			video.removeEventListener("pause", onPause);
			video.removeEventListener("ratechange", onRate);
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
	function speakerName(turn: Turn): string {
		const personId = cast.speakerToPerson[turn.speaker];
		if (personId !== undefined) return nameOf(personId);
		return cast.voiceNames[turn.speaker] || "Nobody";
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

	/** Apply a framing change as one undo step. */
	function edit(next: FramingRegion[]) {
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
			case "Delete":
			case "Backspace":
				if (selectedRegion) goWide(selectedRegion.id);
				break;
			case "Escape":
				setSelectedRegionId(null);
				break;
			default:
				return;
		}
		e.preventDefault();
	}

	const framing = resolveFraming(regions, faces.people, currentTime);

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
		edit(addRegion(regions, targetTurn.start, targetTurn.end, "split", ids));
	}

	function goWide(id: string) {
		edit(regions.filter((r) => r.id !== id));
		setSelectedRegionId(null);
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

	const selectedRegion = regions.find((r) => r.id === selectedRegionId) ?? null;
	const reviewCount = turns.filter(
		(t) =>
			cast.speakerToPerson[t.speaker] === undefined || overlapFor(overlapWindows, t.start, t.end),
	).length;

	const dotExt = file.name.lastIndexOf(".");
	const baseName = dotExt > 0 ? file.name.slice(0, dotExt) : file.name;
	const ext = dotExt > 0 ? file.name.slice(dotExt) : "";

	const framingLabel =
		framing.kind === "wide"
			? "Wide"
			: framing.kind === "split"
				? framing.subjects.map((s) => nameOf(s.personId)).join(" + ")
				: `Close on ${nameOf(framing.subjects[0].personId)}`;
	const cropped = framing.kind !== "wide";

	return (
		<div className="flex h-screen flex-col bg-bg">
			<header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-chrome px-3">
				<Logo size={18} className="text-text" />
				<span className="font-mono text-[12px] text-text">
					{baseName}
					<span className="text-text3">{ext}</span>
				</span>
				<div className="flex-1" />
				<ThemeSwitcher mode={themeMode} onChange={onThemeModeChange} />
				<span
					className={`h-[7px] w-[7px] rounded-full ${health ? "bg-ok" : "bg-text3"}`}
					title={
						health ? "The processing service is running" : "The processing service is not answering"
					}
				/>
			</header>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<aside className="flex w-[404px] shrink-0 flex-col overflow-y-auto border-r border-line bg-panel">
					<div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
						<span className="text-[13px] font-semibold text-text">Transcript</span>
						{reviewCount > 0 && (
							<span className="flex items-center gap-1.5 rounded-card bg-raised px-2 py-1 font-mono text-[10px] text-text2">
								<span className="h-2 w-2 rounded-[2px] bg-accent" />
								{reviewCount} to review
							</span>
						)}
					</div>
					<div className="flex flex-col">
						{turns.map((t, i) => {
							const overlap = overlapFor(overlapWindows, t.start, t.end);
							const assigned = cast.speakerToPerson[t.speaker] ?? null;
							const selected = i === selectedTurn;
							const needsAttention = assigned === null;
							const borderColor = selected
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
									onClick={() => selectTurn(i)}
									className={`border-l-[3px] px-3 py-2.5 text-left ${borderColor} ${selected ? "bg-sel" : ""}`}
								>
									<div className="mb-1 flex flex-wrap items-center gap-2">
										<span
											className={`h-[7px] w-[7px] shrink-0 rounded-full ${SPEAKER_DOT[t.speaker % SPEAKER_DOT.length]}`}
										/>
										<span className="text-[11.5px] font-semibold text-text">{speakerName(t)}</span>
										<span className="font-mono text-[10px] text-text3">
											{formatTime(t.start)}–{formatTime(t.end)}
										</span>
										{needsAttention && (
											<span className="rounded-chip bg-warn-bg px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.04em] text-warn">
												NO FACE
											</span>
										)}
										{overlap && (
											<span className="rounded-chip bg-warn-bg px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.04em] text-warn">
												TALKING OVER
											</span>
										)}
									</div>
									<p
										className={
											selected
												? "text-[13.5px] leading-[1.6] text-text"
												: "text-[12.5px] leading-[1.55] text-text3"
										}
									>
										{t.text}
									</p>
									<p className="mt-1 text-[11px] leading-[1.5] text-text3">{reasonFor(i)}</p>
								</button>
							);
						})}
					</div>
				</aside>

				<main className="flex min-h-0 flex-1 flex-col gap-3 p-6">
					<div
						ref={stageRef}
						className="relative min-h-0 flex-1 overflow-hidden rounded-card bg-black"
						// An audio-only file reports a 0x0 frame; without a fallback the stage
						// collapses to nothing.
						style={{
							aspectRatio:
								faces.frameWidth > 0 && faces.frameHeight > 0
									? `${faces.frameWidth} / ${faces.frameHeight}`
									: "16 / 9",
						}}
					>
						{videoUrl && (
							<video
								ref={videoRef}
								src={videoUrl}
								playsInline
								className={`h-full w-full object-contain ${cropped ? "opacity-0" : ""}`}
							/>
						)}

						{videoUrl && framing.kind === "zoom" && (
							<div className="absolute inset-0">
								<CroppedVideo
									videoUrl={videoUrl}
									bbox={framing.subjects[0].bbox}
									frameWidth={faces.frameWidth}
									frameHeight={faces.frameHeight}
									paneWidth={stageSize.width}
									paneHeight={stageSize.height}
									driverRef={videoRef}
								/>
							</div>
						)}

						{videoUrl && framing.kind === "split" && (
							<div className="absolute inset-0">
								{framing.subjects.length <= DUO_SPLIT_MAX ? (
									<div className="flex h-full">
										{framing.subjects.map((subject) => (
											<div
												key={subject.personId}
												className="h-full flex-1 border-l border-black first:border-l-0"
											>
												<CroppedVideo
													videoUrl={videoUrl}
													bbox={subject.bbox}
													frameWidth={faces.frameWidth}
													frameHeight={faces.frameHeight}
													paneWidth={stageSize.width / framing.subjects.length}
													paneHeight={stageSize.height}
													label={nameOf(subject.personId)}
													driverRef={videoRef}
												/>
											</div>
										))}
									</div>
								) : (
									// Three or more: speaker large, everyone else down the side.
									// Splitting 16:9 into N equal columns gives slivers past two.
									<div className="flex h-full">
										<div style={{ width: `${SPEAKER_FOCUS_MAIN_FRACTION * 100}%` }} className="h-full">
											<CroppedVideo
												videoUrl={videoUrl}
												bbox={framing.subjects[0].bbox}
												frameWidth={faces.frameWidth}
												frameHeight={faces.frameHeight}
												paneWidth={stageSize.width * SPEAKER_FOCUS_MAIN_FRACTION}
												paneHeight={stageSize.height}
												label={nameOf(framing.subjects[0].personId)}
												driverRef={videoRef}
											/>
										</div>
										<div className="flex h-full flex-1 flex-col border-l border-black">
											{framing.subjects.slice(1).map((subject) => (
												<div
													key={subject.personId}
													className="flex-1 border-t border-black first:border-t-0"
												>
													<CroppedVideo
														videoUrl={videoUrl}
														bbox={subject.bbox}
														frameWidth={faces.frameWidth}
														frameHeight={faces.frameHeight}
														paneWidth={stageSize.width * (1 - SPEAKER_FOCUS_MAIN_FRACTION)}
														paneHeight={stageSize.height / (framing.subjects.length - 1)}
														label={nameOf(subject.personId)}
														driverRef={videoRef}
													/>
												</div>
											))}
										</div>
									</div>
								)}
							</div>
						)}

						<div className="pointer-events-none absolute top-2 left-2 flex gap-1.5">
							<span className="rounded-chip bg-black/55 px-1.5 py-0.5 text-[10px] text-plate-ink">
								{framingLabel}
							</span>
							<span className="rounded-chip bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-plate-ink">
								{faces.frameWidth > 0 ? `${faces.frameWidth}×${faces.frameHeight}` : "audio only"}
							</span>
						</div>
						<span className="pointer-events-none absolute right-2 bottom-2 rounded-chip bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-plate-ink">
							{formatTime(currentTime)}
						</span>
					</div>

					<div className="flex shrink-0 items-center gap-3">
						<button
							type="button"
							onClick={togglePlay}
							className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-on-accent"
							aria-label={playing ? "Pause" : "Play"}
							title={`${playing ? "Pause" : "Play"} (Space)`}
						>
							{playing ? "❚❚" : "▶"}
						</button>
						<span className="font-mono text-[11px] text-text2">
							{formatTime(currentTime)} / {formatTime(duration)}
							{rate !== 1 && <span className="ml-2 text-accent-text">{rate}×</span>}
						</span>
						<div className="flex-1" />
						<span
							className={`rounded-chip px-2 py-1 font-mono text-[10px] ${
								captionsEnabled && captionsAvailable
									? "bg-control text-text2"
									: "bg-control text-text3"
							}`}
						>
							{captionsAvailable
								? captionsEnabled
									? "Captions on"
									: "Captions off"
								: "No captions"}
						</span>
					</div>
				</main>
			</div>

			<div className="shrink-0 border-t border-line bg-panel px-4 py-3">
				<div className="mb-2 flex items-center gap-2">
					<span className="font-mono text-[9.5px] tracking-[0.08em] text-text3">FRAMING</span>
					<button
						type="button"
						onClick={addCloseUp}
						disabled={targetPerson === undefined}
						className="rounded-control border border-line bg-control px-2 py-1 text-[11px] text-text2 disabled:opacity-40"
					>
						+ {LAYOUT_LABELS.zoom}
					</button>
					<button
						type="button"
						onClick={addBothOnScreen}
						disabled={!targetTurn}
						className="rounded-control border border-line bg-control px-2 py-1 text-[11px] text-text2 disabled:opacity-40"
					>
						+ {LAYOUT_LABELS.split}
					</button>
					{/* Not built yet, shown rather than hidden. No issue link: there is
					    no issue for this yet, and a link to nothing is worse than none. */}
					<button
						type="button"
						disabled
						title="Notes on screen: captions for names, terms and links, drawn over the video. Not built yet — it's next after clips."
						className="cursor-not-allowed rounded-control border border-dashed border-line px-2 py-1 text-[11px] text-text3"
					>
						+ Note
					</button>
					<div className="flex-1" />
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => zoomBy(2)}
							disabled={!zoomed}
							aria-label="Zoom out"
							title="Zoom out (−). Pinch or ⌘-scroll on the timeline works too."
							className="h-6 w-6 rounded-control border border-line bg-control text-[12px] text-text2 disabled:opacity-40"
						>
							−
						</button>
						<button
							type="button"
							onClick={() => zoomBy(0.5)}
							disabled={view.end - view.start <= MIN_VIEW_S}
							aria-label="Zoom in"
							title="Zoom in (=). Pinch or ⌘-scroll on the timeline works too."
							className="h-6 w-6 rounded-control border border-line bg-control text-[12px] text-text2 disabled:opacity-40"
						>
							+
						</button>
						<button
							type="button"
							onClick={() => setZoomed(null)}
							disabled={!zoomed}
							title="Show the whole episode (Shift Z)"
							className="rounded-control border border-line px-2 py-1 text-[11px] text-text2 disabled:opacity-40"
						>
							Show all
						</button>
						<button
							type="button"
							popoverTarget="editor-shortcuts"
							className="rounded-control border border-line px-2 py-1 text-[11px] text-text2"
						>
							Shortcuts
						</button>
						<div
							id="editor-shortcuts"
							popover="auto"
							className="m-auto rounded-card border border-line bg-panel p-4 text-text shadow-lg"
						>
							<p className="mb-3 text-[13px] font-semibold">Keyboard shortcuts</p>
							<dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
								{SHORTCUTS.map(([keys, what]) => (
									<Fragment key={keys}>
										<dt>
											<kbd className="rounded-chip bg-raised px-1.5 py-0.5 text-[11px] text-text2">{keys}</kbd>
										</dt>
										<dd className="text-[12px] text-text3">{what}</dd>
									</Fragment>
								))}
							</dl>
						</div>
					</div>
					<div className="w-2" />
					<span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.08em] text-text3">
						<span className="h-[9px] w-[9px] rounded-[2px] bg-r-close" />
						SUGGESTED
					</span>
					<span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.08em] text-text3">
						<span className="h-[9px] w-[9px] rounded-[2px] border border-handle bg-r-mine" />
						YOURS
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
					nameOf={(id) => nameOf(id)}
					onViewChange={changeView}
					onSelectRegion={setSelectedRegionId}
					onEditStart={() => {
						dragStart.current = regions;
					}}
					onResize={resize}
					onSeek={seek}
				/>

				<div className="mt-3 flex items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						{selectedRegion ? (
							<>
								<span className="font-mono text-[11px] text-text2">
									{formatTime(selectedRegion.start, true)}–{formatTime(selectedRegion.end, true)}
								</span>
								<span className="text-[11px] text-text3">
									Drag either edge. It snaps to the nearest word; hold Option to place it freely.
								</span>
								<button
									type="button"
									onClick={() => goWide(selectedRegion.id)}
									className="rounded-control border border-line px-2 py-1 text-[11px] text-text2"
								>
									Go wide here
								</button>
							</>
						) : (
							<span className="text-[11px] text-text3">
								Pick a shot on the timeline to move its edges, or a line in the transcript to jump
								there.
							</span>
						)}
					</div>
					<div className="flex items-center gap-3">
						<label
							className="flex items-center gap-2 text-[12px] text-text2"
							title="Cuts long pauses down to a short beat and removes standalone filler words (um, uh). Conservative on purpose -- see docs/FEATURES.md."
						>
							<input
								type="checkbox"
								checked={trimDeadAirEnabled}
								onChange={(e) => onTrimDeadAirChange(e.target.checked)}
							/>
							Trim dead air
						</label>
						<button
							type="button"
							onClick={undo}
							disabled={history.past.length === 0}
							title="Undo (⌘Z)"
							className="rounded-control border border-line px-2 py-1 text-[11px] text-text2 disabled:opacity-40"
						>
							Undo
						</button>
						<button
							type="button"
							onClick={redo}
							disabled={history.future.length === 0}
							title="Redo (⇧⌘Z)"
							className="rounded-control border border-line px-2 py-1 text-[11px] text-text2 disabled:opacity-40"
						>
							Redo
						</button>
						<button
							type="button"
							onClick={() => {
								edit(suggested);
								setSelectedRegionId(null);
							}}
							className="rounded-control border border-line px-2 py-1 text-[11px] text-text2"
						>
							Reset to suggested
						</button>
						<button
							type="button"
							onClick={() => onPublish(duration)}
							className="rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
						>
							Export episode
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
