import { useState } from "react";

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
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
			<h1 className="text-3xl font-semibold">Podcast Editor</h1>
			<p className="max-w-md text-sm text-neutral-500">
				Drop in a podcast recording. It'll transcribe it, split it into
				speaker turns, and suggest zoom/split-screen framing for each one —
				you can override anything before exporting.
			</p>
			<label
				onDragOver={(e) => {
					e.preventDefault();
					setIsDraggingOver(true);
				}}
				onDragLeave={() => setIsDraggingOver(false)}
				onDrop={handleDrop}
				className={`mt-2 cursor-pointer rounded-lg border border-dashed px-6 py-10 text-sm transition-colors ${
					isDraggingOver
						? "border-neutral-700 bg-neutral-100 text-neutral-700 dark:border-neutral-300 dark:bg-neutral-800 dark:text-neutral-300"
						: "border-neutral-400 text-neutral-500 hover:border-neutral-600"
				}`}
			>
				{isDraggingOver ? "Drop it here" : "Drop a file here, or choose a video or audio file"}
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
			{error && <p className="max-w-md text-sm text-red-500">{error}</p>}
			<p className="max-w-md text-xs text-neutral-400">
				Needs the local processing service running (
				<code>cd server && uv run uvicorn main:app --port 8787</code>) — transcribes,
				diarizes, and detects faces in one pass.
			</p>
		</div>
	);
}
