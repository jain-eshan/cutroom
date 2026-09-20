import { Button, Screen, ScreenHeading, SectionLabel } from "@/components/ui";
import { setConsent } from "@/lib/telemetry";

/** Both lists in full, because a promise about what is collected is worth
 * exactly as much as the list beside it. Kept next to the `Event` union in
 * src/lib/telemetry.ts -- if one changes, so does the other. */
const SENT = [
	"That Cutroom opened, on which operating system, and which version it is",
	"Whether the install finished, and how long it took",
	"That a recording started processing, and whether it finished or failed",
	"How long processing took, and how many people were found",
	"That an export finished",
];

const NEVER_SENT = [
	"Your recording, or any part of it",
	"File names, folders, transcripts, or the names you give people",
	"Error messages — they carry the path of the recording that caused them",
	"Anything that identifies you, your machine or where you are",
];

/**
 * Asked once, on the first launch, before the setup gate.
 *
 * Before the setup gate rather than after it because the install is the part
 * most likely to be where someone gives up, and asking afterwards would only
 * ever hear from the people it worked for.
 *
 * Cutroom's whole argument is that nothing leaves the machine, so this is a
 * question and not a notice: the answer is no until somebody says otherwise,
 * and saying no costs nothing and is never asked again.
 */
export function TelemetryConsent({ onAnswered }: { onAnswered: () => void }) {
	function answer(value: "on" | "off") {
		setConsent(value);
		onAnswered();
	}

	return (
		<Screen width={560}>
			<ScreenHeading title="Can Cutroom send anonymous usage counts?">
				Cutroom is a developer preview, and the one thing we can't see from here is where it stops
				working for you — whether the install finished, whether a recording made it through, whether you
				ever got a video out. A handful of counts would tell us that.
			</ScreenHeading>

			<div className="flex flex-col gap-[18px] rounded-card border border-line bg-raised p-[18px]">
				<div className="flex flex-col gap-[9px]">
					<SectionLabel>What would be sent</SectionLabel>
					<ul className="flex flex-col gap-[5px]">
						{SENT.map((item) => (
							<li key={item} className="text-meta text-pretty text-text2">
								{item}
							</li>
						))}
					</ul>
				</div>
				<div className="flex flex-col gap-[9px]">
					<SectionLabel>What is never sent</SectionLabel>
					<ul className="flex flex-col gap-[5px]">
						{NEVER_SENT.map((item) => (
							<li key={item} className="text-meta text-pretty text-text3">
								{item}
							</li>
						))}
					</ul>
				</div>
			</div>

			{/* Neither answer is the accented one: this is a real either/or, and
			    the screen shouldn't lean on it. */}
			<div className="flex flex-wrap items-center gap-[10px]">
				<Button variant="secondary" onClick={() => answer("on")}>
					Yes, send the counts
				</Button>
				<Button variant="quiet" onClick={() => answer("off")}>
					No, keep it all local
				</Button>
			</div>

			<p className="text-fine text-pretty text-text3">
				Either way, your recording stays on this machine. You can change this whenever you like from
				<span className="font-mono text-mono-xs text-text2"> usage data </span>
				in the title bar.
			</p>
		</Screen>
	);
}
