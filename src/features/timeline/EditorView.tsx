import { useEffect, useRef, useState } from "react";
import type { DetectFacesResponse, Turn } from "@/lib/api";
import { bboxAtTime, computeZoomStyle } from "@/lib/faceCrop";
import { ExportButton } from "@/features/timeline/ExportButton";
import { LAYOUT_LABELS, type Layout } from "@/features/timeline/types";

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

export function EditorView({
	file,
	turns,
	faces,
	speakerToTrack,
}: {
	file: File;
	turns: Turn[];
	faces: DetectFacesResponse;
	speakerToTrack: Record<number, number>;
}) {
	// Object URL has to be created *inside* the effect (not derived via useMemo)
	// so StrictMode's mount->cleanup->mount dev-mode cycle recreates a fresh URL
	// each time instead of revoking the one useMemo cached and never remaking.
	const [videoUrl, setVideoUrl] = useState<string | null>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const [activeTurn, setActiveTurn] = useState<number | null>(null);

	// Defaults to "zoom" when the turn's speaker has a labeled face, else "original".
	const [layouts, setLayouts] = useState<Record<number, Layout>>(() => {
		const initial: Record<number, Layout> = {};
		turns.forEach((t, i) => {
			initial[i] = speakerToTrack[t.speaker] !== undefined ? "zoom" : "original";
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
	const trackId = turn ? speakerToTrack[turn.speaker] : undefined;
	const track = trackId !== undefined ? faces.tracks.find((t) => t.id === trackId) : undefined;
	const zoomStyle =
		track && turn && activeLayout === "zoom"
			? computeZoomStyle(bboxAtTime(track, turn.start), faces.frameWidth, faces.frameHeight)
			: undefined;

	return (
		<div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10">
			<div
				className="relative overflow-hidden rounded-lg bg-black"
				style={{ aspectRatio: `${faces.frameWidth} / ${faces.frameHeight}` }}
			>
				{videoUrl && (
					<video
						ref={videoRef}
						src={videoUrl}
						controls
						className="h-full w-full object-cover transition-transform duration-500 ease-out"
						style={zoomStyle}
					/>
				)}
				{activeLayout === "split" && (
					<div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-white">
						Split-screen preview — coming in a later phase (needs the render pipeline)
					</div>
				)}
			</div>
			<p className="text-xs text-neutral-400">
				Click a turn to seek there. Original/Zoom are live CSS previews standing in for the
				real compositor/export pipeline (later phase); Split is a placeholder for now.
			</p>
			<div className="flex flex-col gap-2">
				{turns.map((t, i) => (
					<div
						key={i}
						className={`rounded-lg border-l-4 p-3 text-sm ${SPEAKER_COLORS[t.speaker % SPEAKER_COLORS.length]} ${
							i === activeTurn ? "ring-2 ring-blue-400" : ""
						}`}
					>
						<button type="button" onClick={() => playTurn(i)} className="block w-full text-left">
							<div className="mb-1 flex items-center gap-2 text-xs font-medium text-neutral-500">
								<span>Speaker {t.speaker + 1}</span>
								<span>
									{formatTime(t.start)}–{formatTime(t.end)}
								</span>
								{speakerToTrack[t.speaker] === undefined && (
									<span className="text-amber-500">no face mapped</span>
								)}
							</div>
							<p>{t.text}</p>
						</button>
						<div className="mt-2 flex items-center gap-2">
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
				))}
			</div>
			<ExportButton />
		</div>
	);
}
