import { useState } from "react";
import { exportVideo, type DetectFacesResponse, type Turn, type Word } from "@/lib/api";
import type { FramingRegion } from "@/features/timeline/types";

type ExportState =
	| { status: "idle" }
	| { status: "exporting" }
	| { status: "done"; url: string; filename: string }
	| { status: "error"; message: string };

export function ExportButton({
	file,
	sessionId,
	regions,
	turns,
	words,
	captionsEnabled,
	trimDeadAirEnabled,
	faces,
}: {
	file: File;
	sessionId: string;
	regions: FramingRegion[];
	turns: Turn[];
	words: Word[];
	captionsEnabled: boolean;
	trimDeadAirEnabled: boolean;
	faces: DetectFacesResponse;
}) {
	const [state, setState] = useState<ExportState>({ status: "idle" });

	async function handleExport() {
		setState({ status: "exporting" });
		try {
			const blob = await exportVideo(
				file,
				regions.map((r) => ({
					start: r.start,
					end: r.end,
					layout: r.layout,
					personIds: r.personIds,
					source: r.source,
				})),
				turns.map((t) => ({ start: t.start, end: t.end })),
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
					Leave this window open — closing it stops the render.
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
					Save {state.filename}
				</a>
				<button
					type="button"
					onClick={() => setState({ status: "idle" })}
					className="text-[11px] text-text3 underline"
				>
					Render again
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
				<p className="text-[11px] text-text3">Your edits are safe.</p>
				{/* The raw server message, in mono, underneath the plain-English
				    line -- never instead of it. It has to stay copy-pasteable
				    into a GitHub issue. */}
				<p className="max-w-xs rounded-control border border-warn/45 bg-terminal px-2 py-1.5 text-right font-mono text-[10px] text-warn">
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
