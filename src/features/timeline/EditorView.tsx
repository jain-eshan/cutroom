import { useCallback, useEffect, useRef, useState } from "react";
import type { DetectFacesResponse, OverlapWindow, Turn, Word } from "@/lib/api";
import type { CastResult } from "@/features/faces/CastScreen";
import { bboxAtTime, personCrop } from "@/lib/faceCrop";
import { ExportButton } from "@/features/timeline/ExportButton";
import { LAYOUT_LABELS, type Layout } from "@/features/timeline/types";
import { Logo } from "@/components/Logo";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import type { ThemeMode } from "@/lib/theme";

// Two people get a side-by-side split; three or more get the speaker-focus
// layout instead of N narrow columns. Must match render.py's DUO_SPLIT_MAX
// and SPEAKER_FOCUS_MAIN_FRACTION.
const DUO_SPLIT_MAX = 2;
const SPEAKER_FOCUS_MAIN_FRACTION = 0.68;

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

// Pane cap is 3 -- see docs/design/handoff README, speaker colour tokens.
const SPEAKER_DOT = ["bg-s1", "bg-s2", "bg-s3"];

const LAYOUTS: Layout[] = ["original", "zoom", "split"];

function overlapFor(overlapWindows: OverlapWindow[], start: number, end: number): OverlapWindow | undefined {
	return overlapWindows.find((w) => w.start < end && w.end > start);
}

/** Which people to show in a composite, as person ids: a real overlap window
 * if one covers the turn, otherwise (a manually forced Split) the turn's own
 * person plus whoever most recently spoke before them. Mirrors render.py. */
function compositePeople(
	activeIndex: number,
	turns: Turn[],
	overlapWindows: OverlapWindow[],
	personForTurn: (index: number) => number | null,
	speakerToPerson: Record<number, number>,
): number[] {
	const turn = turns[activeIndex];
	const overlap = overlapFor(overlapWindows, turn.start, turn.end);
	if (overlap) {
		const ids = overlap.speakers
			.map((sp) => speakerToPerson[sp])
			.filter((id): id is number => id !== undefined);
		return [...new Set(ids)];
	}

	const own = personForTurn(activeIndex);
	const people: number[] = own === null ? [] : [own];
	for (let i = activeIndex - 1; i >= 0; i--) {
		const other = personForTurn(i);
		if (other !== null && other !== own) {
			people.push(other);
			break;
		}
	}
	return people;
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
	bbox: ReturnType<typeof bboxAtTime> | undefined;
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
				<span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
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
	themeMode: ThemeMode;
	onThemeModeChange: (mode: ThemeMode) => void;
}) {
	const [captionsEnabled, setCaptionsEnabled] = useState(true);
	// Off by default, unlike captions -- this one actually removes content
	// (dead air, filler words) rather than adding something on top, so it
	// shouldn't be a silent default. See pipeline/trim.py.
	const [trimDeadAirEnabled, setTrimDeadAirEnabled] = useState(false);
	// Object URL has to be created *inside* the effect (not derived via useMemo)
	// so StrictMode's mount->cleanup->mount dev-mode cycle recreates a fresh URL
	// each time instead of revoking the one useMemo cached and never remaking.
	const [videoUrl, setVideoUrl] = useState<string | null>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const [activeTurn, setActiveTurn] = useState<number | null>(null);
	const [stageRef, stageSize] = useElementSize();

	// Per-turn correction of who is on screen. Diarisation suggests it via the
	// voice-to-person mapping; any turn it gets wrong can be fixed here without
	// re-running anything.
	const [personOverrides, setPersonOverrides] = useState<Record<number, number | null>>({});

	function personForTurn(index: number): number | null {
		const override = personOverrides[index];
		if (override !== undefined) return override;
		const mapped = cast.speakerToPerson[turns[index].speaker];
		return mapped === undefined ? null : mapped;
	}

	function nameOf(personId: number | null): string {
		if (personId === null) return "Nobody";
		return cast.names[personId] || `Person ${personId + 1}`;
	}

	const [layouts, setLayouts] = useState<Record<number, Layout>>(() => {
		const initial: Record<number, Layout> = {};
		turns.forEach((t, i) => {
			initial[i] = cast.speakerToPerson[t.speaker] !== undefined ? "zoom" : "original";
		});
		return initial;
	});

	useEffect(() => {
		const url = URL.createObjectURL(file);
		setVideoUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	function playTurn(i: number) {
		setActiveTurn(i);
		const video = videoRef.current;
		if (video) {
			video.currentTime = turns[i].start;
			video.play();
		}
	}

	const turn = activeTurn !== null ? turns[activeTurn] : null;
	const activeLayout = activeTurn !== null ? layouts[activeTurn] : undefined;

	function bboxForPerson(personId: number | null) {
		if (personId === null || !turn) return undefined;
		const person = faces.people.find((p) => p.id === personId);
		return person ? bboxAtTime(person, turn.start) : undefined;
	}

	const activePerson = activeTurn !== null ? personForTurn(activeTurn) : null;
	const compositeList =
		activeTurn !== null && activeLayout === "split"
			? compositePeople(activeTurn, turns, overlapWindows, personForTurn, cast.speakerToPerson)
			: [];
	const showComposite = compositeList.length >= 2;
	const showSingle = activeLayout === "zoom" && Boolean(bboxForPerson(activePerson));
	const cropped = showComposite || Boolean(showSingle);

	const dotExt = file.name.lastIndexOf(".");
	const baseName = dotExt > 0 ? file.name.slice(0, dotExt) : file.name;
	const ext = dotExt > 0 ? file.name.slice(dotExt) : "";
	const reviewCount = turns.filter(
		(t, i) => personForTurn(i) === null || overlapFor(overlapWindows, t.start, t.end),
	).length;

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
			</header>

			<div className="flex flex-1 overflow-hidden">
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
							const assigned = personForTurn(i);
							const corrected = personOverrides[i] !== undefined;
							const selected = i === activeTurn;
							const needsAttention = assigned === null;
							const borderColor = selected
								? "border-l-accent"
								: overlap
									? "border-l-r-both"
									: needsAttention
										? "border-l-warn"
										: "border-l-transparent";
							return (
								<div
									key={i}
									className={`border-l-[3px] px-3 py-2.5 ${borderColor} ${selected ? "bg-sel" : ""}`}
								>
									<button type="button" onClick={() => playTurn(i)} className="block w-full text-left">
										<div className="mb-1 flex flex-wrap items-center gap-2">
											<span className={`h-[7px] w-[7px] shrink-0 rounded-full ${SPEAKER_DOT[t.speaker % SPEAKER_DOT.length]}`} />
											<span className="text-[11.5px] font-semibold text-text">{nameOf(assigned)}</span>
											<span className="font-mono text-[10px] text-text3">
												{formatTime(t.start)}–{formatTime(t.end)}
											</span>
											{corrected && <span className="font-mono text-[10px] text-accent-text">corrected</span>}
											{needsAttention && (
												<span className="rounded-chip bg-warn-bg px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.04em] text-warn">
													NOBODY ASSIGNED
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
									</button>
									<div className="mt-2 flex flex-wrap items-center gap-2">
										<select
											value={assigned === null ? "" : String(assigned)}
											onChange={(e) =>
												setPersonOverrides((prev) => ({
													...prev,
													[i]: e.target.value === "" ? null : Number(e.target.value),
												}))
											}
											title="Who is on screen for this turn"
											className="rounded-control border border-line bg-control px-1.5 py-1 font-mono text-[10px] text-text"
										>
											<option value="">Nobody</option>
											{faces.people.map((p) => (
												<option key={p.id} value={p.id}>
													{nameOf(p.id)}
												</option>
											))}
										</select>
										<div className="flex overflow-hidden rounded-control border border-line text-[10px]">
											{LAYOUTS.map((layout) => (
												<button
													key={layout}
													type="button"
													onClick={() => setLayouts((prev) => ({ ...prev, [i]: layout }))}
													className={`px-2 py-1 font-mono ${
														layouts[i] === layout ? "bg-accent text-on-accent" : "bg-control text-text2"
													}`}
												>
													{LAYOUT_LABELS[layout]}
												</button>
											))}
										</div>
										<button
											type="button"
											disabled
											title="Annotations (text/bubbles) — not built yet, see docs/FEATURES.md"
											className="cursor-not-allowed rounded-control border border-dashed border-line px-2 py-1 font-mono text-[10px] text-text3"
										>
											+ Annotation
										</button>
									</div>
								</div>
							);
						})}
					</div>
				</aside>

				<main className="flex flex-1 flex-col gap-3 overflow-y-auto p-6">
					<div
						ref={stageRef}
						className="relative overflow-hidden rounded-card bg-black"
						style={{ aspectRatio: `${faces.frameWidth} / ${faces.frameHeight}` }}
					>
				{videoUrl && (
					<video
						ref={videoRef}
						src={videoUrl}
						controls={!cropped}
						className={`h-full w-full object-cover ${cropped ? "opacity-0" : ""}`}
					/>
				)}

				{videoUrl && showSingle && turn && (
					<div className="absolute inset-0">
						<CroppedVideo
							videoUrl={videoUrl}
							bbox={bboxForPerson(activePerson)}
							frameWidth={faces.frameWidth}
							frameHeight={faces.frameHeight}
							paneWidth={stageSize.width}
							paneHeight={stageSize.height}
							driverRef={videoRef}
						/>
					</div>
				)}

				{videoUrl && activeLayout === "split" && (
					<div className="absolute inset-0">
						{!showComposite ? (
							<div className="flex h-full items-center justify-center bg-black/70 px-6 text-center text-sm text-white">
								Split needs a second labelled person, and there isn't one nearby on this turn.
							</div>
						) : compositeList.length <= DUO_SPLIT_MAX ? (
							<div className="flex h-full">
								{compositeList.map((personId) => (
									<div key={personId} className="h-full flex-1 border-l border-black first:border-l-0">
										<CroppedVideo
											videoUrl={videoUrl}
											bbox={bboxForPerson(personId)}
											frameWidth={faces.frameWidth}
											frameHeight={faces.frameHeight}
											paneWidth={stageSize.width / compositeList.length}
											paneHeight={stageSize.height}
											label={nameOf(personId)}
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
										bbox={bboxForPerson(compositeList[0])}
										frameWidth={faces.frameWidth}
										frameHeight={faces.frameHeight}
										paneWidth={stageSize.width * SPEAKER_FOCUS_MAIN_FRACTION}
										paneHeight={stageSize.height}
										label={nameOf(compositeList[0])}
										driverRef={videoRef}
									/>
								</div>
								<div className="flex h-full flex-1 flex-col border-l border-black">
									{compositeList.slice(1).map((personId) => (
										<div key={personId} className="flex-1 border-t border-black first:border-t-0">
											<CroppedVideo
												videoUrl={videoUrl}
												bbox={bboxForPerson(personId)}
												frameWidth={faces.frameWidth}
												frameHeight={faces.frameHeight}
												paneWidth={stageSize.width * (1 - SPEAKER_FOCUS_MAIN_FRACTION)}
												paneHeight={stageSize.height / (compositeList.length - 1)}
												label={nameOf(personId)}
												driverRef={videoRef}
											/>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				)}
			</div>
				<p className="text-[11px] text-text3">
						Click a turn to seek there. These previews use the same framing maths as the export.
					</p>
				</main>
			</div>

			<footer className="flex shrink-0 items-center justify-between gap-4 border-t border-line bg-panel px-4 py-3">
				<div className="flex items-center gap-4">
					<label className="flex w-fit items-center gap-2 text-[12px] text-text2">
						<input
							type="checkbox"
							checked={captionsEnabled}
							onChange={(e) => setCaptionsEnabled(e.target.checked)}
						/>
						Captions on
					</label>
					<label
						className="flex w-fit items-center gap-2 text-[12px] text-text2"
						title="Cuts long pauses down to a short beat and removes standalone filler words (um, uh). Conservative on purpose -- see docs/FEATURES.md."
					>
						<input
							type="checkbox"
							checked={trimDeadAirEnabled}
							onChange={(e) => setTrimDeadAirEnabled(e.target.checked)}
						/>
						Trim dead air &amp; filler words
					</label>
				</div>
				<ExportButton
					file={file}
					sessionId={sessionId}
					turns={turns}
					layouts={layouts}
					overlapWindows={overlapWindows}
					words={words}
					captionsEnabled={captionsEnabled}
					trimDeadAirEnabled={trimDeadAirEnabled}
					faces={faces}
					speakerToPerson={cast.speakerToPerson}
					personForTurn={personForTurn}
				/>
			</footer>
		</div>
	);
}
