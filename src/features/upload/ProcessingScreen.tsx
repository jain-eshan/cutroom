import type { JobProgress } from "@/lib/api";

function Bar({ fraction, indeterminate }: { fraction: number; indeterminate?: boolean }) {
	return (
		<div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
			<div
				className={`h-full rounded-full bg-neutral-900 transition-[width] duration-300 dark:bg-neutral-100 ${
					indeterminate ? "animate-pulse" : ""
				}`}
				style={{ width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` }}
			/>
		</div>
	);
}

function Row({
	title,
	stage,
	fraction,
	done,
	showPercent,
}: {
	title: string;
	stage: string;
	fraction: number;
	done: boolean;
	showPercent: boolean;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-4 text-sm">
				<span className="font-medium">{title}</span>
				<span className="text-xs text-neutral-500">
					{done ? "done" : stage}
					{!done && showPercent && fraction > 0 ? ` · ${Math.round(fraction * 100)}%` : ""}
				</span>
			</div>
			<Bar fraction={done ? 1 : fraction} indeterminate={!done && fraction === 0} />
		</div>
	);
}

function formatElapsed(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function ProcessingScreen({
	uploadFraction,
	progress,
	elapsedSeconds,
	fileName,
	fileSizeBytes,
}: {
	uploadFraction: number;
	progress: JobProgress | null;
	elapsedSeconds: number;
	fileName: string;
	fileSizeBytes: number;
}) {
	const uploading = uploadFraction < 1;
	const megabytes = fileSizeBytes / (1024 * 1024);

	return (
		<div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
			<div className="flex flex-col gap-1">
				<h2 className="text-lg font-semibold">
					{uploading ? "Uploading" : "Processing"} {fileName}
				</h2>
				<p className="text-sm text-neutral-500">
					{megabytes >= 1 ? `${megabytes.toFixed(0)} MB` : `${fileSizeBytes} bytes`} · everything
					runs on your machine, nothing is uploaded anywhere
				</p>
			</div>

			<div className="flex flex-col gap-4">
				<Row
					title="Upload"
					stage={uploading ? "sending to the local service" : "done"}
					fraction={uploadFraction}
					done={!uploading}
					showPercent
				/>
				<Row
					title="Transcript & speakers"
					stage={progress?.transcribe.stage ?? "waiting"}
					fraction={progress?.transcribe.fraction ?? 0}
					done={progress?.transcribe.done ?? false}
					showPercent
				/>
				<Row
					title="Faces"
					stage={progress?.faces.stage ?? "waiting"}
					fraction={progress?.faces.fraction ?? 0}
					done={progress?.faces.done ?? false}
					showPercent
				/>
			</div>

			<p className="text-xs text-neutral-400">
				Elapsed {formatElapsed(elapsedSeconds)}. Measured on a laptop CPU, processing runs at
				roughly a fifth of real time — about a minute of work for a five-minute recording,
				plus however long the upload itself takes.
			</p>
		</div>
	);
}
