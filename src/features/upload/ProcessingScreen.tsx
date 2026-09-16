import { useEffect, useRef } from "react";
import { faceThumbnailUrl, jobMediaUrl, type JobProgress } from "@/lib/api";
import { formatClock } from "@/lib/format";
import { overallProgress, remainingLabel } from "@/features/upload/processingProgress";

const SPEAKER_RING = ["border-s1", "border-s2", "border-s3"];

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

	const overall = overallProgress(uploadFraction, transcribe, faces, match);
	const remaining = remainingLabel(elapsedSeconds, overall);

	const lines = progress?.lines ?? [];
	const people = progress?.people ?? [];

	// The upload is already saved server-side by the time this screen shows
	// anything (see pipeline/jobs.py) -- a live preview of the actual
	// recording, not just text, gives the wait something to look at.
	const videoRef = useRef<HTMLVideoElement>(null);
	const position = progress?.position ?? 0;
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		if (Math.abs(video.currentTime - position) > 1) video.currentTime = position;
	}, [position]);

	return (
		<div className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
			<div className="flex w-full max-w-[640px] flex-col gap-6 rounded-panel border border-line bg-panel p-[26px]">
				<div className="flex items-start justify-between gap-4">
					<div className="flex items-center gap-3">
						{!uploading && (
							<video
								ref={videoRef}
								src={jobMediaUrl(jobId)}
								muted
								playsInline
								preload="auto"
								title="Follows along with the transcript below -- not a live playback, just the frame at that position."
								className="h-[46px] w-[72px] shrink-0 rounded-control bg-black object-cover"
							/>
						)}
						<div className="flex flex-col gap-1">
							<h2 className="text-[18px] font-semibold tracking-[-0.01em] text-text">{fileName}</h2>
							<p className="text-[12.5px] text-text3">
								{megabytes >= 1 ? `${megabytes.toFixed(0)} MB` : `${fileSizeBytes} bytes`} · this machine
								is doing the work, not the cloud
							</p>
						</div>
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
					Roughly a fifth of the recording's length on a laptop. Closing this tab won't stop it
					{typeof Notification !== "undefined" && Notification.permission === "granted"
						? " — you'll get a notification when it's ready."
						: " — come back and this page will pick up where it left off."}
				</p>
			</div>
		</div>
	);
}
