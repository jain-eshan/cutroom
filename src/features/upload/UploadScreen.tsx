import { useState } from "react";
import { Button, Screen, ScreenHeading, SectionLabel } from "@/components/ui";
import type { SavedEpisode } from "@/lib/api";

export function UploadScreen({
	onFileSelected,
	savedEpisodes,
	onReopen,
	onDelete,
}: {
	onFileSelected: (file: File) => void;
	/** Finished jobs from previous sessions -- undefined while still loading,
	 * so the list doesn't flash empty-then-populated on every visit. */
	savedEpisodes?: SavedEpisode[];
	onReopen: (jobId: string) => void;
	onDelete: (jobId: string) => void;
}) {
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	// Delete asks once, in place: it sat one pixel from Reopen with no confirm.
	const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

	function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
		e.preventDefault();
		setIsDraggingOver(false);
		const file = e.dataTransfer.files?.[0];
		if (file) onFileSelected(file);
	}

	return (
		<Screen width={560}>
			<div className={isDraggingOver ? "opacity-40" : ""}>
				<ScreenHeading title="Start a new episode">
					One video of everyone in one frame, with one audio track. That's all it needs.
				</ScreenHeading>
			</div>

			<label
				onDragOver={(e) => {
					e.preventDefault();
					setIsDraggingOver(true);
				}}
				onDragLeave={() => setIsDraggingOver(false)}
				onDrop={handleDrop}
				className={`flex cursor-pointer flex-col items-center justify-center gap-[11px] rounded-panel text-center ${
					isDraggingOver
						? "border-2 border-accent bg-accent-wash px-5 py-[44px] shadow-[0_0_0_6px_var(--color-accent-ring)]"
						: "border-[1.5px] border-dashed border-text3/45 bg-panel px-5 py-[30px]"
				}`}
			>
				<span
					className={`flex items-center justify-center ${
						isDraggingOver ? "h-11 w-11 rounded-[10px] bg-accent" : "h-[38px] w-[38px] rounded-panel bg-control"
					}`}
				>
					{/* The upload glyph is a bar drawn in CSS, not an arrow character. */}
					<span
						className={`block rounded-[2px] ${isDraggingOver ? "h-[3px] w-[18px] bg-on-accent" : "h-[2.5px] w-[14px] bg-text2"}`}
					/>
				</span>
				{isDraggingOver ? (
					<span className="text-section font-semibold text-text">Let go to start</span>
				) : (
					<>
						<span className="text-ui font-medium text-text">Drag a recording here</span>
						<span className="text-meta leading-none text-text3">
							or <span className="text-accent-text">choose a file</span>
						</span>
					</>
				)}
				<input
					type="file"
					accept="video/*,audio/*"
					className="hidden"
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) onFileSelected(file);
					}}
				/>
			</label>

			{isDraggingOver ? (
				<p className="text-center text-meta text-pretty text-text3">
					A second file would replace this one — only one recording per episode.
				</p>
			) : (
				<div className="flex items-center gap-[9px] rounded-card bg-chrome px-[13px] py-[11px]">
					<span className="h-[7px] w-[7px] shrink-0 rounded-full bg-ok" />
					<p className="text-meta text-pretty text-text3">
						Everything happens on this machine. Nothing is uploaded, and a 4 GB file doesn't cost you 4 GB
						of bandwidth.
					</p>
				</div>
			)}

			{savedEpisodes && savedEpisodes.length > 0 && !isDraggingOver && (
				<div className="mt-auto flex flex-col gap-[11px]">
					<SectionLabel>Pick up where you left off</SectionLabel>
					{savedEpisodes.map((ep) => (
						<div
							key={ep.jobId}
							className="flex items-center gap-[13px] rounded-card border border-line bg-chrome px-3 py-[10px]"
						>
							<span className="plate-stripes h-7 w-[46px] shrink-0 rounded-[4px]" />
							<span className="flex min-w-0 flex-1 flex-col gap-[3px]">
								<span className="truncate text-ui leading-[1.3] font-semibold text-text">{ep.filename}</span>
								<span className="font-mono text-mono-sm leading-[1.3] text-text3">
									{new Date(ep.createdAt * 1000).toLocaleDateString()} · processed
								</span>
							</span>
							{confirmingDelete === ep.jobId ? (
								<>
									<Button size="sm" variant="quiet" onClick={() => setConfirmingDelete(null)}>
										Keep it
									</Button>
									<Button
										size="sm"
										variant="destructive"
										onClick={() => {
											setConfirmingDelete(null);
											onDelete(ep.jobId);
										}}
									>
										Delete for good
									</Button>
								</>
							) : (
								<>
									<Button
										size="sm"
										variant="quiet"
										onClick={() => onReopen(ep.jobId)}
										title="Picks up from naming the people. Nothing is processed again."
									>
										Reopen
									</Button>
									<Button size="sm" variant="destructive" onClick={() => setConfirmingDelete(ep.jobId)}>
										Delete
									</Button>
								</>
							)}
						</div>
					))}
				</div>
			)}
		</Screen>
	);
}
