import { useEffect, useRef, useState } from "react";
import { Screen, SectionLabel, StageRow } from "@/components/ui";
import { faceThumbnailUrl, jobMediaUrl, type JobProgress } from "@/lib/api";
import { formatClock } from "@/lib/format";
import { overallProgress, remainingLabel } from "@/features/upload/processingProgress";

const SPEAKER_RING = ["border-s1", "border-s2", "border-s3"];

type Stage = { done?: boolean; fraction?: number } | undefined;

function stageState(stage: Stage, waiting: boolean): "done" | "active" | "pending" {
	if (stage?.done) return "done";
	return waiting ? "pending" : "active";
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
	// anything (see pipeline/jobs.py) -- a live frame of the actual recording,
	// not just text, gives the wait something to look at.
	const videoRef = useRef<HTMLVideoElement>(null);
	const position = progress?.position ?? 0;
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		if (Math.abs(video.currentTime - position) > 1) video.currentTime = position;
	}, [position]);
	// A decorative frame, not something to explain a failure over in this
	// little a space -- if it can't load, the plate stays empty.
	const [previewFailed, setPreviewFailed] = useState(false);

	return (
		<Screen width={780}>
			<div className="flex gap-[26px]">
				<div className="flex w-[300px] shrink-0 flex-col gap-[18px]">
					<div className="flex flex-col gap-[5px]">
						<span className="font-mono text-clock text-accent">{formatClock(elapsedSeconds)}</span>
						<span className="text-meta text-text3">{remaining ?? "working out how long"}</span>
					</div>
					<div className="plate-stripes relative flex aspect-video items-center justify-center overflow-hidden rounded-card-lg">
						{!uploading && !previewFailed ? (
							<video
								ref={videoRef}
								src={jobMediaUrl(jobId)}
								muted
								playsInline
								preload="auto"
								onError={() => setPreviewFailed(true)}
								title="Follows along with the transcript -- not playback, just the frame at that position."
								className="absolute inset-0 h-full w-full object-cover"
							/>
						) : (
							<span className="font-mono text-fine leading-[1.6] text-plate-ink">
								{uploading ? "waiting for the file" : "no preview"}
							</span>
						)}
						<span className="absolute right-[14px] bottom-[14px] rounded-control bg-black/55 px-2 py-[5px] font-mono text-mono-xs leading-none text-[oklch(0.92_0.005_80)]">
							{formatClock(position)}
						</span>
					</div>
					<p className="font-mono text-mono-sm text-text3">
						{fileName} · {megabytes >= 1 ? `${megabytes.toFixed(0)} MB` : `${fileSizeBytes} bytes`}
					</p>
					<p className="text-meta text-pretty text-text3">
						You can close this window. The work carries on
						{typeof Notification !== "undefined" && Notification.permission === "granted"
							? ", and you'll get a notification when it's ready."
							: ", and this page picks up where it left off when you come back."}
					</p>
				</div>

				<div className="flex min-w-0 flex-1 flex-col gap-[22px]">
					<div className="flex flex-col gap-[13px]">
						<StageRow label="Sending the file" state={uploading ? "active" : "done"} fraction={uploadFraction} />
						<StageRow
							label="Writing the transcript"
							state={stageState(transcribe, uploading)}
							fraction={transcribe?.fraction}
						/>
						<StageRow label="Finding who's on camera" state={stageState(faces, uploading)} fraction={faces?.fraction} />
						<StageRow
							label="Matching voices to faces"
							state={stageState(match, !(transcribe?.done ?? false) || !(faces?.done ?? false))}
							fraction={match?.fraction}
						/>
					</div>

					<div className="flex flex-col gap-[11px]">
						<SectionLabel>People found · {people.length}</SectionLabel>
						<div className="grid grid-cols-3 gap-[11px]">
							{people.map((personId, i) => (
								<div key={personId} className="flex flex-col items-center gap-[7px]">
									<img
										src={faceThumbnailUrl(jobId, personId)}
										alt=""
										className={`h-[46px] w-[46px] rounded-control-lg border-2 object-cover ${
											SPEAKER_RING[i % SPEAKER_RING.length]
										}`}
									/>
									<span className="font-mono text-mono-xs leading-none text-text3">Person {i + 1}</span>
								</div>
							))}
							{!(faces?.done ?? false) && (
								<div className="flex flex-col items-center gap-[7px] opacity-35">
									<span className="h-[46px] w-[46px] rounded-control-lg border border-dashed border-text3" />
									<span className="font-mono text-mono-xs leading-none text-text3">still looking</span>
								</div>
							)}
						</div>
						<p className="text-meta text-text3">
							{people.length > 0
								? "You'll name them on the next screen."
								: "Recognising people takes the whole pass, so they appear together."}
						</p>
					</div>

					<div className="flex flex-col gap-[9px]">
						<SectionLabel>Transcript so far</SectionLabel>
						{lines.length === 0 ? (
							<p className="text-meta text-text3">The first lines will appear here as they're written.</p>
						) : (
							<div className="flex flex-col gap-[7px]">
								{lines.map((line, i) => {
									// Oldest fade back, newest reads at full strength -- the eye
									// should land on what just arrived.
									const age = lines.length - 1 - i;
									const newest = age === 0;
									return (
										<p
											key={`${i}-${line}`}
											style={{ opacity: Math.max(0.55, 1 - age * 0.09) }}
											className={`text-meta ${newest ? "text-text" : "text-text2"}`}
										>
											{line}
										</p>
									);
								})}
								{progress && progress.duration > 0 && (
									<div className="flex items-center gap-[7px]">
										<span className="h-[13px] w-0.5 bg-accent" />
										<span className="font-mono text-fine leading-none text-text3">
											{formatClock(progress.position)} / {formatClock(progress.duration)}
										</span>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			</div>
		</Screen>
	);
}
