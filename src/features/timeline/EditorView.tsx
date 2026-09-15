import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BBox, DetectFacesResponse, Health, OverlapWindow, Turn, Word } from "@/lib/api";
import type { CastResult } from "@/features/faces/CastScreen";
import { personCrop } from "@/lib/faceCrop";
import { ExportButton } from "@/features/timeline/ExportButton";
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

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

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
			if (driver.paused && !pane.paused) pane.pause();
			else if (!driver.paused && pane.paused) pane.play().catch(() => {});
		};

		for (const ev of ["timeupdate", "seeked", "play", "pause"]) {
			driver.addEventListener(ev, sync);
		}
		sync();
		return () => {
			for (const ev of ["timeupdate", "seeked", "play", "pause"]) {
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
	sessionId,
	turns,
	overlapWindows,
	words,
	faces,
	cast,
	health,
	themeMode,
	onThemeModeChange,
}: {
	file: File;
	sessionId: string;
	turns: Turn[];
	overlapWindows: OverlapWindow[];
	words: Word[];
	faces: DetectFacesResponse;
	cast: CastResult;
	health: Health | null;
	themeMode: ThemeMode;
	onThemeModeChange: (mode: ThemeMode) => void;
}) {
	const captionsAvailable = health?.captions ?? true;
	const [captionsEnabled, setCaptionsEnabled] = useState(captionsAvailable);
	// Off by default, unlike captions -- this one actually removes content
	// (dead air, filler words) rather than adding something on top, so it
	// shouldn't be a silent default. See pipeline/trim.py.
	const [trimDeadAirEnabled, setTrimDeadAirEnabled] = useState(false);
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
	const [regions, setRegions] = useState<FramingRegion[]>(suggested);
	const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
	const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
	const [currentTime, setCurrentTime] = useState(0);
	const [playing, setPlaying] = useState(false);
	// Until the file's metadata loads, the last turn is the best length we
	// have; the video's own duration is authoritative once it arrives.
	const [duration, setDuration] = useState(() => Math.max(0, ...turns.map((t) => t.end)));

	useEffect(() => {
		const url = URL.createObjectURL(file);
		setVideoUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		const onTime = () => setCurrentTime(video.currentTime);
		const onMeta = () => {
			if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
		};
		const onPlay = () => setPlaying(true);
		const onPause = () => setPlaying(false);
		video.addEventListener("timeupdate", onTime);
		video.addEventListener("loadedmetadata", onMeta);
		video.addEventListener("play", onPlay);
		video.addEventListener("pause", onPause);
		return () => {
			video.removeEventListener("timeupdate", onTime);
			video.removeEventListener("loadedmetadata", onMeta);
			video.removeEventListener("play", onPlay);
			video.removeEventListener("pause", onPause);
		};
	}, [videoUrl]);

	function nameOf(personId: number | null): string {
		if (personId === null) return "Nobody";
		return cast.names[personId] || `Person ${personId + 1}`;
	}

	function seek(t: number) {
		const video = videoRef.current;
		setCurrentTime(t);
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
		if (video.paused) void video.play();
		else video.pause();
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
		setRegions(addRegion(regions, targetTurn.start, targetTurn.end, "zoom", [targetPerson]));
	}

	function addBothOnScreen() {
		if (!targetTurn) return;
		const other = otherSpeakerNear(turns, cast.speakerToPerson, targetTurn.start, targetPerson);
		const ids = [targetPerson, other].filter((id): id is number => id !== undefined);
		if (ids.length < 2) return;
		setRegions(addRegion(regions, targetTurn.start, targetTurn.end, "split", ids));
	}

	function goWide(id: string) {
		setRegions(regions.filter((r) => r.id !== id));
		setSelectedRegionId(null);
	}

	/** One clause saying what was done here and why, in the words the user
	 * would use. Never announces that something was automatic -- it shows the
	 * result and the reason, and the override does the reassuring. */
	function reasonFor(index: number): string {
		const turn = turns[index];
		const region = regionAt(regions, turn.start + 0.01);
		const speakerName = nameOf(cast.speakerToPerson[turn.speaker] ?? null);

		if (!region) {
			if (cast.speakerToPerson[turn.speaker] === undefined) {
				return "We couldn't see a face for this voice, so we stayed wide.";
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
		return `${speakerName} is talking alone here, so we cut in close.`;
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
										<span className="text-[11.5px] font-semibold text-text">{nameOf(assigned)}</span>
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
						style={{ aspectRatio: `${faces.frameWidth} / ${faces.frameHeight}` }}
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
								{faces.frameWidth}×{faces.frameHeight}
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
						>
							{playing ? "❚❚" : "▶"}
						</button>
						<span className="font-mono text-[11px] text-text2">
							{formatTime(currentTime)} / {formatTime(duration)}
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
					<div className="flex-1" />
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
					regions={regions}
					turns={turns}
					selectedRegionId={selectedRegionId}
					currentTime={currentTime}
					nameOf={(id) => nameOf(id)}
					onSelectRegion={setSelectedRegionId}
					onResize={(id, edge, to) => setRegions((rs) => resizeRegion(rs, id, edge, to, duration))}
					onSeek={seek}
				/>

				<div className="mt-3 flex items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						{selectedRegion ? (
							<>
								<span className="text-[11px] text-text3">
									Drag either edge to change where this shot starts and ends.
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
							className={`flex items-center gap-2 text-[12px] ${captionsAvailable ? "text-text2" : "text-text3"}`}
							title={
								captionsAvailable
									? undefined
									: "This ffmpeg was built without libass, so it can't burn in subtitles. `brew install ffmpeg-full`, then set FFMPEG_BINARY in server/.env."
							}
						>
							<input
								type="checkbox"
								checked={captionsEnabled && captionsAvailable}
								disabled={!captionsAvailable}
								onChange={(e) => setCaptionsEnabled(e.target.checked)}
							/>
							{captionsAvailable ? "Captions" : "Captions need libass"}
						</label>
						<label
							className="flex items-center gap-2 text-[12px] text-text2"
							title="Cuts long pauses down to a short beat and removes standalone filler words (um, uh). Conservative on purpose -- see docs/FEATURES.md."
						>
							<input
								type="checkbox"
								checked={trimDeadAirEnabled}
								onChange={(e) => setTrimDeadAirEnabled(e.target.checked)}
							/>
							Trim dead air
						</label>
						<button
							type="button"
							onClick={() => {
								setRegions(suggested);
								setSelectedRegionId(null);
							}}
							className="rounded-control border border-line px-2 py-1 text-[11px] text-text2"
						>
							Reset to suggested
						</button>
						<ExportButton
							file={file}
							sessionId={sessionId}
							regions={regions}
							turns={turns}
							words={words}
							captionsEnabled={captionsEnabled && captionsAvailable}
							trimDeadAirEnabled={trimDeadAirEnabled}
							faces={faces}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
