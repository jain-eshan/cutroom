import { useCallback, useRef } from "react";
import type { Turn } from "@/lib/api";
import { LAYOUT_LABELS, type FramingRegion } from "@/features/timeline/types";
import { wideGaps } from "@/features/timeline/regions";

const SPEAKER_LANE = ["bg-s1", "bg-s2", "bg-s3"];

type DragEdge = { id: string; edge: "start" | "end" };

function percent(value: number, duration: number): number {
	if (duration <= 0) return 0;
	return Math.max(0, Math.min(100, (value / duration) * 100));
}

export function TimelineTray({
	duration,
	regions,
	turns,
	selectedRegionId,
	currentTime,
	nameOf,
	onSelectRegion,
	onResize,
	onSeek,
}: {
	duration: number;
	regions: FramingRegion[];
	turns: Turn[];
	selectedRegionId: string | null;
	currentTime: number;
	nameOf: (personId: number) => string;
	onSelectRegion: (id: string | null) => void;
	onResize: (id: string, edge: "start" | "end", to: number) => void;
	onSeek: (t: number) => void;
}) {
	const laneRef = useRef<HTMLDivElement>(null);
	// A ref, not state: the drag has to be live from the very first move event,
	// and a state update wouldn't have been applied yet.
	const dragging = useRef<DragEdge | null>(null);

	const timeAt = useCallback(
		(clientX: number): number => {
			const lane = laneRef.current;
			if (!lane || duration <= 0) return 0;
			const rect = lane.getBoundingClientRect();
			const ratio = (clientX - rect.left) / rect.width;
			return Math.max(0, Math.min(duration, ratio * duration));
		},
		[duration],
	);

	const gaps = wideGaps(regions, duration);
	const speakers = [...new Set(turns.map((t) => t.speaker))].sort((a, b) => a - b);

	function regionLabel(region: FramingRegion): string {
		const names = region.personIds.map(nameOf);
		if (region.layout === "zoom") return `Close on ${names[0] ?? "nobody"}`;
		return names.length > 1 ? names.join(" + ") : LAYOUT_LABELS.split;
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="relative">
				{/* Framing lane */}
				<div
					ref={laneRef}
					onPointerDown={(e) => {
						if (e.target === e.currentTarget) {
							onSelectRegion(null);
							onSeek(timeAt(e.clientX));
						}
					}}
					className="relative h-[38px] w-full overflow-hidden rounded-[5px] border border-line bg-track"
				>
					{gaps.map((gap) => (
						<div
							key={`gap-${gap.start}`}
							className="absolute inset-y-0 bg-r-wide"
							style={{
								left: `${percent(gap.start, duration)}%`,
								width: `${percent(gap.end - gap.start, duration)}%`,
							}}
						/>
					))}

					{regions.map((region) => {
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
								className={`absolute inset-y-0 flex items-center overflow-hidden rounded-chip px-1.5 ${
									mine
										? "border border-handle bg-r-mine text-r-mine-ink"
										: `${region.layout === "split" ? "bg-r-both" : "bg-r-close"} text-r-ink`
								} ${isSelected ? "ring-1 ring-handle" : ""}`}
								style={{
									left: `${percent(region.start, duration)}%`,
									width: `${percent(region.end - region.start, duration)}%`,
								}}
							>
								<span className="truncate text-[10px] font-medium whitespace-nowrap">
									{regionLabel(region)}
								</span>

								{isSelected && (
									<>
										{(["start", "end"] as const).map((edge) => (
											<span
												key={edge}
												// Pointer capture rather than window listeners: the pointer
												// leaves a 4px target immediately, and capture retargets
												// every later move to this element without a React round
												// trip that a fast drag would outrun.
												onPointerDown={(e) => {
													e.stopPropagation();
													e.preventDefault();
													e.currentTarget.setPointerCapture(e.pointerId);
													dragging.current = { id: region.id, edge };
												}}
												onPointerMove={(e) => {
													if (!dragging.current) return;
													onResize(dragging.current.id, dragging.current.edge, timeAt(e.clientX));
												}}
												onPointerUp={(e) => {
													dragging.current = null;
													e.currentTarget.releasePointerCapture(e.pointerId);
												}}
												className="absolute top-[6px] bottom-[6px] w-[4px] cursor-ew-resize rounded-[2px] bg-handle"
												style={edge === "start" ? { left: 3 } : { right: 3 }}
											/>
										))}
									</>
								)}
							</div>
						);
					})}

					{/* Playhead */}
					<div
						className="pointer-events-none absolute inset-y-0 w-[2px] bg-handle"
						style={{ left: `${percent(currentTime, duration)}%` }}
					/>
				</div>
			</div>

			{/* Speaker lanes -- who is actually talking, under the framing that
			    covers them, so a region's disagreement with the speech is visible. */}
			<div className="flex flex-col gap-1">
				{speakers.map((speaker, i) => (
					<div key={speaker} className="relative h-[15px] w-full overflow-hidden rounded-chip bg-track">
						{turns
							.filter((t) => t.speaker === speaker)
							.map((t) => (
								<div
									key={`${speaker}-${t.start}`}
									className={`absolute inset-y-0 ${SPEAKER_LANE[i % SPEAKER_LANE.length]}`}
									style={{
										left: `${percent(t.start, duration)}%`,
										width: `${percent(t.end - t.start, duration)}%`,
									}}
								/>
							))}
					</div>
				))}
			</div>
		</div>
	);
}
