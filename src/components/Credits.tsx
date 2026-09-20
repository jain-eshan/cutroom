import { ButtonLink, SectionLabel } from "@/components/ui";

/**
 * Who made the models and tools Cutroom ships.
 *
 * Not decoration: the app redistributes other people's work inside its own
 * installer -- five model weights and an ffmpeg binary -- and every one of
 * those licences asks for attribution in return. pyannote's CC-BY-4.0 is the
 * one that made this screen necessary rather than merely polite, since the
 * weights are only bundled (and the Hugging Face sign-up only removed) on the
 * strength of that clause. See server/.models/diarization/NOTICE.md.
 *
 * A native popover, like the editor's Shortcuts sheet -- the browser handles
 * light-dismiss, focus and the top layer, so none of that is rebuilt here.
 */

type Credit = {
	name: string;
	what: string;
	licence: string;
	href: string;
};

/** Ordered by how much of the edit each one decides, not alphabetically. */
const CREDITS: Credit[] = [
	{
		name: "pyannote.audio",
		what: "Speaker diarisation — who is talking, and when they talk over each other. The community-1 weights ship inside Cutroom.",
		licence: "CC-BY-4.0",
		href: "https://huggingface.co/pyannote/speaker-diarization-community-1",
	},
	{
		name: "Whisper, via faster-whisper",
		what: "Transcription, with the word-level timings the captions and the snapping are cut from.",
		licence: "MIT",
		href: "https://github.com/SYSTRAN/faster-whisper",
	},
	{
		name: "LR-ASD",
		what: "Active speaker detection — which face on screen is the one speaking, which is what matches voices to people.",
		licence: "MIT",
		href: "https://github.com/Junhua-Liao/LR-ASD",
	},
	{
		name: "YuNet",
		what: "Face detection. Ships inside Cutroom.",
		licence: "MIT",
		href: "https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet",
	},
	{
		name: "SFace",
		what: "Face recognition — collapsing separate sightings of one person into one person.",
		licence: "Apache-2.0",
		href: "https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface",
	},
	{
		name: "FFmpeg",
		what: "Decoding, cutting and rendering every frame. Cutroom ships a GPL build and calls it as a separate program; its full licence is in the app's own folder, beside the binary.",
		licence: "GPL-3.0",
		href: "https://ffmpeg.org/legal.html",
	},
];

export function CreditsSheet({ id }: { id: string }) {
	return (
		<div
			id={id}
			popover="auto"
			className="m-auto max-h-[80vh] w-[min(560px,90vw)] overflow-auto rounded-card-lg border border-line bg-panel p-[18px] text-text shadow-panel"
		>
			<p className="text-section font-semibold">Built on</p>
			<p className="mt-[7px] text-ui text-text3">
				Cutroom edits on this machine because other people published the models that make it possible. These
				ship inside the app, under their own licences.
			</p>
			<dl className="mt-[15px] flex flex-col gap-[13px]">
				{CREDITS.map((credit) => (
					<div key={credit.name} className="flex flex-col gap-[3px]">
						<dt className="flex items-baseline gap-[9px]">
							<ButtonLink variant="ghost" href={credit.href} target="_blank" rel="noreferrer" className="text-ui font-semibold">
								{credit.name}
							</ButtonLink>
							<SectionLabel>{credit.licence}</SectionLabel>
						</dt>
						<dd className="text-meta text-text3">{credit.what}</dd>
					</div>
				))}
			</dl>
			<p className="mt-[15px] border-t border-line pt-[13px] text-fine text-text3">
				Cutroom itself is MIT. The rest of what it depends on is listed in the repository.
			</p>
		</div>
	);
}
