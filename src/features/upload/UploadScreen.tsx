import { useState } from "react";
import { Logo } from "@/components/Logo";

export function UploadScreen({
	onFileSelected,
	error,
}: {
	onFileSelected: (file: File) => void;
	error?: string;
}) {
	const [isDraggingOver, setIsDraggingOver] = useState(false);

	function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
		e.preventDefault();
		setIsDraggingOver(false);
		const file = e.dataTransfer.files?.[0];
		if (file) onFileSelected(file);
	}

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 py-10">
			<div
				className={`flex w-full max-w-[412px] flex-col gap-5 rounded-panel border p-[26px] transition-colors ${
					isDraggingOver ? "border-2 border-accent shadow-[0_0_0_6px_oklch(0.74_0.16_52/0.12)]" : "border-line"
				}`}
			>
				<div
					className={`flex flex-col items-center gap-2 text-center transition-opacity ${isDraggingOver ? "opacity-40" : ""}`}
				>
					<Logo size={40} className="text-text" />
					<h1 className="text-[18px] font-semibold tracking-[-0.01em] text-text">Cutroom</h1>
					<p className="max-w-sm text-[12.5px] leading-[1.6] text-text3">
						Drop in a single-camera recording. It transcribes it, works out who's on camera and
						when, and suggests framing you can change before publishing.
					</p>
				</div>

				<label
					onDragOver={(e) => {
						e.preventDefault();
						setIsDraggingOver(true);
					}}
					onDragLeave={() => setIsDraggingOver(false)}
					onDrop={handleDrop}
					className={`flex cursor-pointer flex-col items-center gap-3 rounded-[9px] border-[1.5px] border-dashed py-[30px] text-center transition-colors ${
						isDraggingOver ? "border-2 border-accent bg-accent/9" : "border-line bg-panel"
					}`}
				>
					<span className="flex h-[38px] w-[38px] items-center justify-center rounded-card bg-control text-text3">
						↓
					</span>
					{isDraggingOver ? (
						<span className="text-[13px] font-medium text-text">Let go to start</span>
					) : (
						<span className="text-[13px] font-medium text-text">
							Drag a recording here
							<br />
							<span className="font-normal text-text3">
								or <span className="text-accent-text">choose a file</span>
							</span>
						</span>
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
				{isDraggingOver && (
					<p className="-mt-2 text-center text-[11px] text-text3">
						A second file would replace this one — only one recording per episode.
					</p>
				)}

				<div className="flex items-start gap-2 rounded-card border border-line bg-raised p-3">
					<span className="mt-1 h-[7px] w-[7px] shrink-0 rounded-full bg-ok" />
					<p className="text-[11px] leading-[1.6] text-text3">
						Everything happens on this machine. Nothing is uploaded, and a 4 GB file doesn't cost
						you 4 GB of bandwidth.
					</p>
				</div>

				{error && <p className="text-[12.5px] text-warn">{error}</p>}
			</div>
		</div>
	);
}
