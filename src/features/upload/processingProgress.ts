/**
 * How far a `/process` job has actually got, and how long is left -- kept
 * pure and separate from ProcessingScreen.tsx so it can be unit tested
 * under Node (that file pulls in `src/lib/api.ts`, which reads
 * `import.meta.env` and only exists under Vite).
 */

export interface StageLike {
	fraction: number;
	done: boolean;
}

/** Below this the extrapolation is mostly noise -- an estimate that starts at
 * "47 minutes" and falls to two is worse than no estimate. */
export const ESTIMATE_FLOOR = 0.08;

function stageFraction(s: StageLike | undefined): number {
	return s?.done ? 1 : (s?.fraction ?? 0);
}

/**
 * Overall progress across upload, transcribe, faces and match, as a
 * fraction of the whole job.
 *
 * Transcribe and faces run concurrently -- `/process`'s own comment says so
 * ("both analyses run concurrently in threads... they genuinely overlap")
 * -- so wall-clock time is gated by whichever is slower, not their sum.
 * Averaging all four stages as if they were four equal, sequential chunks
 * (the previous approach) double-counts the one that finishes early: a run
 * where faces finishes at 10% and transcribe crawls to 50% would read as
 * "30% done" when the wall clock has only moved as far as transcribe has.
 * Treating the concurrent pair as *one* phase via `max` matches how the
 * time is actually spent, without needing a guessed weight for either
 * stage's relative speed -- there's no reliable one; which stage is the
 * long pole depends on the recording.
 */
export function overallProgress(uploadFraction: number, transcribe?: StageLike, faces?: StageLike, match?: StageLike): number {
	const concurrent = Math.max(stageFraction(transcribe), stageFraction(faces));
	return (uploadFraction + concurrent + stageFraction(match)) / 3;
}

/** Extrapolated from how far the job has actually got, not from a tuned
 * constant, so it corrects itself instead of being confidently wrong. */
export function remainingLabel(elapsed: number, fraction: number): string | null {
	if (fraction < ESTIMATE_FLOOR || fraction >= 1) return null;
	const remaining = (elapsed * (1 - fraction)) / fraction;
	if (remaining < 60) return "under a minute left";
	return `about ${Math.ceil(remaining / 60)} min left`;
}
