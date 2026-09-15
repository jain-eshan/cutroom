import { faceThumbnailUrl, type JobProgress } from "@/lib/api";

const SPEAKER_RING = ["border-s1", "border-s2", "border-s3"];

/** Below this the extrapolation is mostly noise -- an estimate that starts at
 * "47 minutes" and falls to two is worse than no estimate. */
const ESTIMATE_FLOOR = 0.08;

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

function formatClock(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Extrapolated from how far the job has actually got, not from a tuned
 * constant, so it corrects itself instead of being confidently wrong. */
function remainingLabel(elapsed: number, fraction: number): string | null {
	if (fraction < ESTIMATE_FLOOR || fraction >= 1) return null;
	const remaining = (elapsed * (1 - fraction)) / fraction;
	if (remaining < 60) return "under a minute left";
	return `about ${Math.ceil(remaining / 60)} min left`;
}

export function ProcessingScreen({
	jobId,
	uploadFraction,
	progress,
	elapsedSeconds,
	fileName,
	fileSizeBytes,
}: {
	jobId: string;
	uploadFraction: number;
	progress: JobProgress | null;
	elapsedSeconds: number;
	fileName: string;
	fileSizeBytes: number;
}) {
	const uploading = uploadFraction < 1;
	const megabytes = fileSizeBytes / (1024 * 1024);

	const transcribe = progress?.transcribe;
	const faces = progress?.faces;
	const match = progress?.match;

	const stageFraction = (s: { fraction: number; done: boolean } | undefined) =>
		s?.done ? 1 : (s?.fraction ?? 0);
	const overall =
		(uploadFraction + stageFraction(transcribe) + stageFraction(faces) + stageFraction(match)) / 4;
	const remaining = remainingLabel(elapsedSeconds, overall);

	const lines = progress?.lines ?? [];
	const people = progress?.people ?? [];

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
					<div className="flex shrink-0 flex-col items-end">
						<span className="font-mono text-[22px] text-accent">{formatClock(elapsedSeconds)}</span>
						{remaining && <span className="text-[10.5px] text-text3">{remaining}</span>}
					</div>
				</div>

				<div className="flex flex-col gap-4">
					<Row title="Sending the file" fraction={uploadFraction} done={!uploading} pending={false} />
					<Row
						title="Writing the transcript"
						fraction={transcribe?.fraction ?? 0}
						done={transcribe?.done ?? false}
						pending={uploading}
					/>
					<Row
						title="Finding who's on camera"
						fraction={faces?.fraction ?? 0}
						done={faces?.done ?? false}
						pending={uploading}
					/>
					<Row
						title="Matching voices to faces"
						fraction={match?.fraction ?? 0}
						done={match?.done ?? false}
						pending={!(transcribe?.done ?? false) || !(faces?.done ?? false)}
					/>
				</div>

				<div className="grid grid-cols-[1fr_208px] gap-5 border-t border-line pt-5">
					<div className="flex min-w-0 flex-col gap-2">
						<div className="flex items-baseline justify-between gap-3">
							<span className="font-mono text-[9.5px] tracking-[0.08em] text-text3">TRANSCRIPT</span>
							{progress && progress.duration > 0 && (
								<span className="font-mono text-[10px] text-text3">
									{formatClock(progress.position)} / {formatClock(progress.duration)}
								</span>
							)}
						</div>
						{lines.length === 0 ? (
							<p className="text-[12.5px] leading-[1.6] text-text3">
								The first lines will appear here as they're written.
							</p>
						) : (
							<div className="flex flex-col gap-1">
								{lines.map((line, i) => {
									// Oldest fade back, newest reads at full strength -- the eye
									// should land on what just arrived.
									const age = lines.length - 1 - i;
									const opacity = Math.max(0.55, 1 - age * 0.09);
									const newest = i === lines.length - 1;
									return (
										<p
											key={`${i}-${line}`}
											style={{ opacity }}
											className={`text-[12.5px] leading-[1.6] ${newest ? "text-text" : "text-text2"}`}
										>
											{line}
											{newest && (
												<span className="ml-1 inline-block h-[13px] w-[2px] translate-y-[2px] animate-pulse bg-accent" />
											)}
										</p>
									);
								})}
							</div>
						)}
					</div>

					<div className="flex flex-col gap-2">
						<span className="font-mono text-[9.5px] tracking-[0.08em] text-text3">FACES FOUND</span>
						<div className="flex flex-wrap gap-2">
							{people.map((personId, i) => (
								<img
									key={personId}
									src={faceThumbnailUrl(jobId, personId)}
									alt=""
									className={`h-[46px] w-[46px] rounded-control border-2 object-cover ${
										SPEAKER_RING[i % SPEAKER_RING.length]
									}`}
								/>
							))}
							{!(faces?.done ?? false) && (
								<span className="h-[46px] w-[46px] rounded-control border-2 border-dashed border-line" />
							)}
						</div>
						<p className="text-[11px] leading-[1.5] text-text3">
							{people.length > 0
								? "You'll name them on the next screen."
								: "Recognising people takes the whole pass — they appear together."}
						</p>
					</div>
				</div>

				<p className="text-[11px] leading-[1.7] text-text3">
					Roughly a fifth of the recording's length on a laptop. Keep this tab open — the work is
					happening on your machine, not in the cloud.
				</p>
			</div>
		</div>
	);
}
