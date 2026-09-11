export function UploadScreen({
	onFileSelected,
	error,
}: {
	onFileSelected: (file: File) => void;
	error?: string;
}) {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
			<h1 className="text-3xl font-semibold">Podcast Editor</h1>
			<p className="max-w-md text-sm text-neutral-500">
				Drop in a podcast recording. It'll transcribe it, split it into
				speaker turns, and suggest zoom/split-screen framing for each one —
				you can override anything before exporting.
			</p>
			<label className="mt-2 cursor-pointer rounded-lg border border-dashed border-neutral-400 px-6 py-10 text-sm text-neutral-500 hover:border-neutral-600">
				Choose a video or audio file
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
