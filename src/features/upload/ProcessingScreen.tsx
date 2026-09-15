import type { JobProgress } from "@/lib/api";

function Bar({ fraction, indeterminate, done }: { fraction: number; indeterminate?: boolean; done: boolean }) {
	return (
		<div className="h-[6px] w-full overflow-hidden rounded-[3px] bg-track">
			<div
				className={`h-full rounded-[3px] transition-[width] duration-300 ${done ? "bg-ok" : "bg-accent"} ${
					indeterminate ? "animate-pulse" : ""
				}`}
				style={{ width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` }}
			/>
		</div>
	);
}

function Row({
	title,
	fraction,
	done,
	pending,
}: {
	title: string;
	fraction: number;
	done: boolean;
	pending: boolean;
}) {
	return (
		<div
			className={`grid grid-cols-[150px_1fr_46px] items-center gap-3 transition-opacity ${pending ? "opacity-50" : ""}`}
		>
			<span className="text-[13px] font-medium text-text">{title}</span>
			<Bar fraction={done ? 1 : fraction} indeterminate={!done && fraction === 0 && !pending} done={done} />
			<span className="justify-self-end font-mono text-[11px] text-text3">
				{done ? "done" : pending ? "—" : `${Math.round(fraction * 100)}%`}
			</span>
		</div>
	);
}

function formatElapsed(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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
		<div className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
			<div className="flex w-full max-w-[640px] flex-col gap-6 rounded-panel border border-line bg-panel p-[26px]">
				<div className="flex items-start justify-between gap-4">
					<div className="flex flex-col gap-1">
						<h2 className="text-[18px] font-semibold tracking-[-0.01em] text-text">{fileName}</h2>
						<p className="text-[12.5px] text-text3">
							{megabytes >= 1 ? `${megabytes.toFixed(0)} MB` : `${fileSizeBytes} bytes`} · this machine
							is doing the work, not the cloud
						</p>
					</div>
					<span className="shrink-0 font-mono text-[22px] text-accent">{formatElapsed(elapsedSeconds)}</span>
				</div>

				<div className="flex flex-col gap-4">
					<Row title="Sending the file" fraction={uploadFraction} done={!uploading} pending={false} />
					<Row
						title="Writing the transcript"
						fraction={progress?.transcribe.fraction ?? 0}
						done={progress?.transcribe.done ?? false}
						pending={uploading}
					/>
					<Row
						title="Finding who's on camera"
						fraction={progress?.faces.fraction ?? 0}
						done={progress?.faces.done ?? false}
						pending={uploading || !(progress?.transcribe.done ?? false)}
					/>
					<Row
						title="Matching voices to faces"
						fraction={progress?.match.fraction ?? 0}
						done={progress?.match.done ?? false}
						pending={uploading || !(progress?.faces.done ?? false)}
					/>
				</div>

				<p className="border-t border-line pt-4 text-[11px] leading-[1.7] text-text3">
					Roughly a fifth of the recording's length on a laptop. Keep this tab open — the work is
					happening on your machine, not in the cloud.
				</p>
			</div>
		</div>
	);
}
