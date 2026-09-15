/** Face detection found nobody. Shown instead of the cast step, which would
 * otherwise ask "who is this?" with no faces to choose from. */
export function NoFacesScreen({
	onKeepGoing,
	onPickAnother,
}: {
	onKeepGoing: () => void;
	onPickAnother: () => void;
}) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
			<div className="flex w-full max-w-[520px] flex-col gap-4 rounded-panel border border-line bg-panel p-[26px]">
				<span className="font-mono text-[9.5px] tracking-[0.08em] text-text3">NOBODY ON CAMERA</span>
				<h2 className="text-[18px] font-semibold tracking-[-0.01em] text-text">We couldn't find any faces</h2>
				<p className="text-[12.5px] leading-[1.6] text-text3">
					Maybe it's an audio-only recording, or the camera never saw anyone clearly. Either way
					there's nothing to cut between — so we'll leave the picture alone.
				</p>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onKeepGoing}
						className="rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
					>
						Keep going anyway
					</button>
					<button
						type="button"
						onClick={onPickAnother}
						className="rounded-control border border-line px-3 py-2 text-[13px] text-text2"
					>
						Pick a different file
					</button>
				</div>
			</div>
		</div>
	);
}
