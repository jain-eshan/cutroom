import { useState } from "react";
import {
	exportVideo,
	type DetectFacesResponse,
	type LayoutChoice,
	type OverlapSegment,
	type OverlapWindow,
	type Turn,
	type Word,
} from "@/lib/api";
import type { Layout } from "@/features/timeline/types";

type ExportState =
	| { status: "idle" }
	| { status: "exporting" }
	| { status: "done"; url: string; filename: string }
	| { status: "error"; message: string };

export function ExportButton({
	file,
	sessionId,
	turns,
	layouts,
	overlapWindows,
	words,
	captionsEnabled,
	trimDeadAirEnabled,
	faces,
	speakerToPerson,
	personForTurn,
}: {
	file: File;
	sessionId: string;
	turns: Turn[];
	layouts: Record<number, Layout>;
	overlapWindows: OverlapWindow[];
	words: Word[];
	captionsEnabled: boolean;
	trimDeadAirEnabled: boolean;
	faces: DetectFacesResponse;
	speakerToPerson: Record<number, number>;
	/** Resolved person for a turn, including any manual correction. */
	personForTurn: (index: number) => number | null;
}) {
	const [state, setState] = useState<ExportState>({ status: "idle" });

	async function handleExport() {
		setState({ status: "exporting" });
		try {
			const layoutChoices: LayoutChoice[] = turns.map((t, i) => ({
				turnIndex: i,
				personId: personForTurn(i),
				start: t.start,
				end: t.end,
				defaultLayout: speakerToPerson[t.speaker] !== undefined ? "zoom" : "original",
				finalLayout: layouts[i] ?? "original",
			}));

			// Overlap windows come back from diarisation as anonymous speakers;
			// resolve them to people before the server sees them, so the render
			// pipeline never has to know diarisation exists.
			const overlapSegments: OverlapSegment[] = overlapWindows.map((w) => ({
				start: w.start,
				end: w.end,
				personIds: [
					...new Set(
						w.speakers
							.map((sp) => speakerToPerson[sp])
							.filter((id): id is number => id !== undefined),
					),
				],
			}));

			const blob = await exportVideo(
				file,
				layoutChoices,
				overlapSegments,
				faces,
				sessionId,
				words,
				captionsEnabled,
				trimDeadAirEnabled,
			);
			const url = URL.createObjectURL(blob);
			const baseName = file.name.replace(/\.[^.]+$/, "");
			setState({ status: "done", url, filename: `${baseName}-edited.mp4` });
		} catch (err) {
			setState({
				status: "error",
				message: err instanceof Error ? err.message : "Export failed for an unknown reason.",
			});
		}
	}

	if (state.status === "exporting") {
		return (
			<div className="flex flex-col items-end gap-1">
				<button
					type="button"
					disabled
					className="flex items-center gap-2 rounded-control bg-control px-4 py-2 text-[13px] font-medium text-text3"
				>
					<span className="h-3 w-3 animate-spin rounded-full border-2 border-text3 border-t-transparent" />
					Rendering…
				</button>
				<p className="max-w-xs text-right text-[11px] text-text3">
					This can take a few minutes for longer episodes — the render re-encodes video per
					segment, it isn't a quick copy.
				</p>
			</div>
		);
	}

	if (state.status === "done") {
		return (
			<div className="flex flex-col items-end gap-1">
				<a
					href={state.url}
					download={state.filename}
					className="rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
				>
					Download {state.filename}
				</a>
				<button
					type="button"
					onClick={() => setState({ status: "idle" })}
					className="text-[11px] text-text3 underline"
				>
					Export again
				</button>
			</div>
		);
	}

	if (state.status === "error") {
		return (
			<div className="flex flex-col items-end gap-1">
				<button
					type="button"
					onClick={handleExport}
					className="rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
				>
					Try again
				</button>
				<p className="max-w-xs rounded-control border border-warn/45 bg-warn-bg px-2 py-1.5 text-right font-mono text-[10px] text-warn">
					{state.message}
				</p>
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={handleExport}
			className="rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
		>
			Export episode
		</button>
	);
}
