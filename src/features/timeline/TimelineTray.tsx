import { useEffect, useMemo, useRef, useState } from "react";
import type { Turn, Word } from "@/lib/api";
import { LAYOUT_LABELS, type FramingRegion } from "@/features/timeline/types";
import { wideGaps } from "@/features/timeline/regions";
import {
	clampView,
	formatTimecode,
	rulerStep,
	sampleWaveform,
	snapTime,
	zoomView,
	type TimeSpan,
} from "@/features/timeline/timelineView";

const SPEAKER_LANE = ["bg-s1", "bg-s2", "bg-s3"];

/** How near, on screen, a dragged edge has to come to a word, a turn, another
 * shot's edge or the playhead before it snaps there. */
const SNAP_PX = 8;

type Drag =
	// `grab`: how far the pointer was from the edge when it was pressed. The
	// handle sits a few pixels inside the shot, so without this, pressing it
	// would jump the edge to wherever the pointer is.
	| { kind: "edge"; id: string; edge: "start" | "end"; targets: number[]; grab: number }
	| { kind: "scrub" }
	| { kind: "overview"; grab: number };

function percent(value: number, duration: number): number {
	if (duration <= 0) return 0;
	return Math.max(0, Math.min(100, (value / duration) * 100));
}

function regionFill(region: FramingRegion): string {
	if (region.source === "user") return "bg-r-mine";
	return region.layout === "split" ? "bg-r-both" : "bg-r-close";
}

export function TimelineTray({
	duration,
	view,
	regions,
	turns,
	words,
	selectedRegionId,
	currentTime,
	nameOf,
	waveform,
	thumbnailUrls,
	onViewChange,
	onSelectRegion,
	onEditStart,
	onResize,
	onSeek,
}: {
	duration: number;
	/** The stretch of the episode the detail lanes show. */
	view: TimeSpan;
	regions: FramingRegion[];
	turns: Turn[];
	words: Word[];
	selectedRegionId: string | null;
	currentTime: number;
	nameOf: (personId: number) => string;
	/** The episode's amplitude envelope, or null until it's fetched. Shown
	 * behind the speaker lanes as a shared reference -- there's one audio
	 * track, not one per person. */
	waveform: number[] | null;
	/** Evenly spaced across [0, duration]. Shown behind the overview so the
	 * minimap reads as the episode, not just a strip of decision colour. */
	thumbnailUrls: string[];
	onViewChange: (view: TimeSpan) => void;
	onSelectRegion: (id: string | null) => void;
	/** Called as a drag begins, so the whole drag can be undone as one step. */
	onEditStart: () => void;
	onResize: (id: string, edge: "start" | "end", to: number) => void;
	onSeek: (t: number) => void;
}) {
	const [detail, setDetail] = useState<HTMLDivElement | null>(null);
	const [width, setWidth] = useState(0);
	const overviewRef = useRef<HTMLDivElement>(null);
	// A ref, not state: a drag has to be live from the very first move event,
	// and a state update wouldn't have been applied yet.
	const dragging = useRef<Drag | null>(null);

	useEffect(() => {
		if (!detail) return;
		const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
		observer.observe(detail);
		return () => observer.disconnect();
	}, [detail]);

	// What the wheel listener reads. It's attached once, so it can't close over
	// props, and it writes the view back here so a burst of wheel events builds
	// on each other instead of all starting from the last render.
	const latest = useRef({ view, duration, width, onViewChange });
	useEffect(() => {
		latest.current = { view, duration, width, onViewChange };
	});

	useEffect(() => {
		if (!detail) return;
		// Native and non-passive because React's onWheel can't preventDefault, and
		// a pinch or ctrl-scroll would otherwise zoom the whole page.
		const onWheel = (e: WheelEvent) => {
			const { view, duration, width, onViewChange } = latest.current;
			if (width <= 0 || duration <= 0) return;
			e.preventDefault();
			const span = view.end - view.start;
			let next: TimeSpan;
			if (e.ctrlKey || e.metaKey) {
				const rect = detail.getBoundingClientRect();
				const anchor = view.start + ((e.clientX - rect.left) / rect.width) * span;
				next = zoomView(view, Math.exp(e.deltaY * 0.01), anchor, duration);
			} else {
				const px = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
				next = clampView(view.start + px * (span / width), span, duration);
			}
			latest.current.view = next;
			onViewChange(next);
		};
		detail.addEventListener("wheel", onWheel, { passive: false });
		return () => detail.removeEventListener("wheel", onWheel);
	}, [detail]);

	const boundaries = useMemo(
		() => [...words.flatMap((w) => [w.start, w.end]), ...turns.flatMap((t) => [t.start, t.end])].sort((a, b) => a - b),
		[words, turns],
	);

	// One bar every ~3px, capped so a huge monitor doesn't turn this into
	// thousands of divs. There's one audio track, so every lane shares it.
	const barCount = Math.min(300, Math.max(20, Math.round(width / 3)));
	const waveformBars = useMemo(
		() => (waveform ? sampleWaveform(waveform, view, duration, barCount) : []),
		[waveform, view, duration, barCount],
	);

	const span = view.end - view.start;
	/** Where a moment sits across the detail lanes, as an unclamped percentage,
	 * so a shot running off either side keeps its true size. */
	const at = (t: number) => (span > 0 ? ((t - view.start) / span) * 100 : 0);
	const inView = (s: { start: number; end: number }) => s.end > view.start && s.start < view.end;

	function timeAt(clientX: number): number {
		if (!detail || span <= 0) return view.start;
		const rect = detail.getBoundingClientRect();
		const t = view.start + ((clientX - rect.left) / rect.width) * span;
		return Math.max(0, Math.min(duration, t));
	}

	function overviewTimeAt(clientX: number): number {
		const el = overviewRef.current;
		if (!el || duration <= 0) return 0;
		const rect = el.getBoundingClientRect();
		return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
	}

	// Pointer capture rather than window listeners: the pointer leaves a 4px
	// handle immediately, and capture keeps sending every later move to the
	// element the drag started on, without a React round trip a fast drag would outrun.
	function startDrag(e: React.PointerEvent, drag: Drag) {
		e.stopPropagation();
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		dragging.current = drag;
	}

	function moveDrag(e: React.PointerEvent) {
		const drag = dragging.current;
		if (!drag) return;
		if (drag.kind === "edge") {
			const t = timeAt(e.clientX) - drag.grab;
			const threshold = width > 0 ? (SNAP_PX * span) / width : 0;
			// Option places the edge freely, the way a held modifier turns snapping
			// off in most editors.
			onResize(drag.id, drag.edge, e.altKey ? t : snapTime(t, drag.targets, threshold));
		} else if (drag.kind === "scrub") {
			onSeek(timeAt(e.clientX));
		} else {
			onViewChange(clampView(overviewTimeAt(e.clientX) - drag.grab, span, duration));
		}
	}

	function endDrag(e: React.PointerEvent) {
		if (!dragging.current) return;
		dragging.current = null;
		e.currentTarget.releasePointerCapture(e.pointerId);
	}

	const dragProps = { onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag };

	const gaps = wideGaps(regions, duration);
	// Full colour with nothing to show through; tinted once there are
	// thumbnails, so the overview reads as the episode with a decision
	// colour over it, not just a strip of colour.
	const overviewTint = thumbnailUrls.length > 0 ? "opacity-70" : "";
	const speakers = [...new Set(turns.map((t) => t.speaker))].sort((a, b) => a - b);

	const { major, minor } = rulerStep(width > 0 ? span / width : span);
	const perMajor = Math.round(major / minor);
	const ticks: number[] = [];
	for (let i = Math.ceil(view.start / minor); i * minor <= view.end; i++) ticks.push(i);

	function regionLabel(region: FramingRegion): string {
		const names = region.personIds.map(nameOf);
		if (region.layout === "zoom") return `Close on ${names[0] ?? "nobody"}`;
		return names.length > 1 ? names.join(" + ") : LAYOUT_LABELS.split;
	}

	return (
		<div className="flex flex-col gap-2">
			{/* Overview: the whole episode, with a window marking what the lanes
			    below show. Drag the window to move along; click elsewhere to jump. */}
			<div
				ref={overviewRef}
				onPointerDown={(e) => {
					const t = overviewTimeAt(e.clientX);
					const inside = t >= view.start && t <= view.end;
					const grab = inside ? t - view.start : span / 2;
					if (!inside) onViewChange(clampView(t - grab, span, duration));
					startDrag(e, { kind: "overview", grab });
				}}
				{...dragProps}
				title="The whole episode. Drag the box to move along it."
				className="relative h-[14px] w-full cursor-grab overflow-hidden rounded-chip border border-line bg-track active:cursor-grabbing"
			>
				{thumbnailUrls.length > 0 && (
					<div className="pointer-events-none absolute inset-0 flex">
						{thumbnailUrls.map((url, i) => (
							<img key={i} src={url} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
						))}
					</div>
				)}
				{gaps.map((gap) => (
					<div
						key={`gap-${gap.start}`}
						className={`absolute inset-y-0 bg-r-wide ${overviewTint}`}
						style={{
							left: `${percent(gap.start, duration)}%`,
							width: `${percent(gap.end - gap.start, duration)}%`,
						}}
					/>
				))}
				{regions.map((region) => (
					<div
						key={region.id}
						className={`absolute inset-y-0 ${regionFill(region)} ${overviewTint}`}
						style={{
							left: `${percent(region.start, duration)}%`,
							width: `${percent(region.end - region.start, duration)}%`,
						}}
					/>
				))}
				<div
					className="pointer-events-none absolute inset-y-0 w-px bg-handle"
					style={{ left: `${percent(currentTime, duration)}%` }}
				/>
				<div
					className="pointer-events-none absolute inset-y-0 min-w-[6px] rounded-[3px] border border-handle bg-handle/15"
					style={{ left: `${percent(view.start, duration)}%`, width: `${percent(span, duration)}%` }}
				/>
			</div>

			<div ref={setDetail} className="relative flex flex-col gap-2">
				{/* Ruler: drag along it to scrub. */}
				<div
					onPointerDown={(e) => {
						startDrag(e, { kind: "scrub" });
						onSeek(timeAt(e.clientX));
					}}
					{...dragProps}
					className="relative -mb-1 h-[18px] cursor-ew-resize overflow-hidden select-none"
				>
					{ticks.map((i) => {
						const labelled = i % perMajor === 0;
						const left = `${at(i * minor)}%`;
						return (
							<div key={i}>
								<div
									className={`absolute bottom-0 w-px ${labelled ? "h-[7px] bg-text3" : "h-[4px] bg-line"}`}
									style={{ left }}
								/>
								{labelled && (
									<span
										className="absolute top-0 translate-x-1 font-mono text-[9.5px] text-text3"
										style={{ left }}
									>
										{formatTimecode(i * minor, major < 1)}
									</span>
								)}
							</div>
						);
					})}
				</div>

				{/* Framing lane */}
				<div
					onPointerDown={(e) => {
						if (e.target === e.currentTarget) {
							onSelectRegion(null);
							onSeek(timeAt(e.clientX));
						}
					}}
					className="relative h-[38px] w-full overflow-hidden rounded-[5px] border border-line bg-track"
				>
					{gaps.filter(inView).map((gap) => (
						<div
							key={`gap-${gap.start}`}
							className="pointer-events-none absolute inset-y-0 bg-r-wide"
							style={{ left: `${at(gap.start)}%`, width: `${at(gap.end) - at(gap.start)}%` }}
						/>
					))}

					{regions.filter(inView).map((region) => {
						const isSelected = region.id === selectedRegionId;
						const mine = region.source === "user";
						return (
							<div
								key={region.id}
								onPointerDown={(e) => {
									e.stopPropagation();
									onSelectRegion(region.id);
								}}
								title={regionLabel(region)}
								className={`absolute inset-y-0 flex items-center overflow-hidden rounded-chip px-1.5 ${regionFill(region)} ${
									mine ? "border border-handle text-r-mine-ink" : "text-r-ink"
								} ${isSelected ? "ring-1 ring-handle" : ""}`}
								style={{ left: `${at(region.start)}%`, width: `${at(region.end) - at(region.start)}%` }}
							>
								<span className="truncate text-[10px] font-medium whitespace-nowrap">
									{regionLabel(region)}
								</span>

								{isSelected &&
									(["start", "end"] as const).map((edge) => (
										<span
											key={edge}
											onPointerDown={(e) => {
												onEditStart();
												const others = regions
													.filter((r) => r.id !== region.id)
													.flatMap((r) => [r.start, r.end]);
												startDrag(e, {
													kind: "edge",
													id: region.id,
													edge,
													// Fixed for the drag: the region's own edges are left out, or
													// the edge would keep snapping back to where it already is.
													targets: [...boundaries, ...others, currentTime].sort((a, b) => a - b),
													grab: timeAt(e.clientX) - region[edge],
												});
											}}
											{...dragProps}
											className="absolute top-[6px] bottom-[6px] w-[4px] cursor-ew-resize rounded-[2px] bg-handle"
											style={edge === "start" ? { left: 3 } : { right: 3 }}
										/>
									))}
							</div>
						);
					})}
				</div>

				{/* Speaker lanes -- who is actually talking, under the framing that
				    covers them, so a region's disagreement with the speech is visible. */}
				<div className="flex flex-col gap-1">
					{speakers.map((speaker, i) => (
						<div key={speaker} className="relative h-[15px] w-full overflow-hidden rounded-chip bg-track">
							{waveformBars.length > 0 && (
								<div className="pointer-events-none absolute inset-0 flex items-end gap-px opacity-35">
									{waveformBars.map((amplitude, j) => (
										<div
											key={j}
											className="min-w-0 flex-1 rounded-t-[1px] bg-text3"
											style={{ height: `${Math.max(6, amplitude * 100)}%` }}
										/>
									))}
								</div>
							)}
							{turns
								.filter((t) => t.speaker === speaker && inView(t))
								.map((t) => (
									<div
										key={`${speaker}-${t.start}`}
										className={`absolute inset-y-0 ${SPEAKER_LANE[i % SPEAKER_LANE.length]}`}
										style={{ left: `${at(t.start)}%`, width: `${at(t.end) - at(t.start)}%` }}
									/>
								))}
						</div>
					))}
				</div>

				{/* Playhead, across the ruler and every lane. */}
				{currentTime >= view.start && currentTime <= view.end && (
					<div
						className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-handle"
						style={{ left: `${at(currentTime)}%` }}
					>
						<div className="absolute top-0 -left-[4px] h-[8px] w-[10px] bg-handle [clip-path:polygon(0_0,100%_0,50%_100%)]" />
					</div>
				)}
			</div>
		</div>
	);
}
