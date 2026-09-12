import { useCallback, useEffect, useRef, useState } from "react";
import type { DetectFacesResponse, OverlapWindow, Turn, Word } from "@/lib/api";
import type { CastResult } from "@/features/faces/CastScreen";
import { bboxAtTime, personCrop } from "@/lib/faceCrop";
import { ExportButton } from "@/features/timeline/ExportButton";
import { LAYOUT_LABELS, type Layout } from "@/features/timeline/types";

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

const SPEAKER_COLORS = [
	"border-blue-400 bg-blue-50 dark:bg-blue-950/30",
	"border-purple-400 bg-purple-50 dark:bg-purple-950/30",
	"border-amber-400 bg-amber-50 dark:bg-amber-950/30",
	"border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
];

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
}: {
	file: File;
	sessionId: string;
	turns: Turn[];
	overlapWindows: OverlapWindow[];
	words: Word[];
	faces: DetectFacesResponse;
	cast: CastResult;
}) {
	const [captionsEnabled, setCaptionsEnabled] = useState(true);
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

	return (
		<div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10">
			<div
				ref={stageRef}
				className="relative overflow-hidden rounded-lg bg-black"
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
			<p className="text-xs text-neutral-400">
				Click a turn to seek there. These previews use the same framing maths as the export.
			</p>
			<div className="flex flex-col gap-2">
				{turns.map((t, i) => {
					const overlap = overlapFor(overlapWindows, t.start, t.end);
					const assigned = personForTurn(i);
					const corrected = personOverrides[i] !== undefined;
					return (
						<div
							key={i}
							className={`rounded-lg border-l-4 p-3 text-sm ${SPEAKER_COLORS[t.speaker % SPEAKER_COLORS.length]} ${
								i === activeTurn ? "ring-2 ring-blue-400" : ""
							}`}
						>
							<button type="button" onClick={() => playTurn(i)} className="block w-full text-left">
								<div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-neutral-500">
									<span className="text-neutral-700 dark:text-neutral-300">{nameOf(assigned)}</span>
									<span>
										{formatTime(t.start)}–{formatTime(t.end)}
									</span>
									{corrected && <span className="text-blue-500">corrected</span>}
									{assigned === null && <span className="text-amber-500">nobody assigned</span>}
									{overlap && (
										<span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400">
											{[...new Set(overlap.speakers.map((sp) => cast.speakerToPerson[sp]))]
												.filter((id): id is number => id !== undefined)
												.map((id) => nameOf(id))
												.join(" + ")}{" "}
											talking over each other
										</span>
									)}
								</div>
								<p>{t.text}</p>
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
									className="rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-xs dark:border-neutral-700"
								>
									<option value="">Nobody</option>
									{faces.people.map((p) => (
										<option key={p.id} value={p.id}>
											{nameOf(p.id)}
										</option>
									))}
								</select>
								<div className="flex overflow-hidden rounded border border-neutral-300 text-xs dark:border-neutral-700">
									{LAYOUTS.map((layout) => (
										<button
											key={layout}
											type="button"
											onClick={() => setLayouts((prev) => ({ ...prev, [i]: layout }))}
											className={`px-2 py-1 ${
												layouts[i] === layout
													? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
													: "bg-transparent"
											}`}
										>
											{LAYOUT_LABELS[layout]}
										</button>
									))}
								</div>
								<button
									type="button"
									disabled
									title="Annotations (text/bubbles) — coming in a later phase"
									className="cursor-not-allowed rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-400 dark:border-neutral-700"
								>
									+ Annotation
								</button>
							</div>
						</div>
					);
				})}
			</div>
			<label className="flex w-fit items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
				<input
					type="checkbox"
					checked={captionsEnabled}
					onChange={(e) => setCaptionsEnabled(e.target.checked)}
				/>
				Burn in captions
			</label>
			<ExportButton
				file={file}
				sessionId={sessionId}
				turns={turns}
				layouts={layouts}
				overlapWindows={overlapWindows}
				words={words}
				captionsEnabled={captionsEnabled}
				faces={faces}
				speakerToPerson={cast.speakerToPerson}
				personForTurn={personForTurn}
			/>
		</div>
	);
}
