import { useState } from "react";
import { getConsent, setConsent } from "@/lib/telemetry";

/**
 * Turning the anonymous counts on or off after the first-run card, from the
 * title bar.
 *
 * A decision that can't be taken back isn't really a decision, and "delete a
 * line from localStorage" is not an answer for the people this product is
 * for. A native popover, like the credits sheet beside it.
 */
export function UsageDataSheet({ id }: { id: string }) {
	const [on, setOn] = useState(() => getConsent() === "on");

	function choose(value: boolean) {
		setOn(value);
		setConsent(value ? "on" : "off");
	}

	return (
		<div
			id={id}
			popover="auto"
			className="m-auto w-[min(440px,90vw)] rounded-card-lg border border-line bg-panel p-[18px] text-text shadow-panel"
		>
			<p className="text-section font-semibold">Usage data</p>
			<p className="mt-[7px] text-ui text-pretty text-text3">
				Six anonymous counts — that Cutroom opened, that the install finished, that a recording was
				processed, that an export finished — so we can see where the preview breaks. Never your
				recording, its name, its transcript, or anything that identifies you.
			</p>

			{/* The segmented control the theme switch uses, so it reads as the
			    same kind of setting rather than something graver. */}
			<div className="mt-[15px] flex w-fit gap-0.5 rounded-card bg-raised p-[3px]">
				{[
					{ value: true, label: "On" },
					{ value: false, label: "Off" },
				].map((option) => (
					<button
						key={option.label}
						type="button"
						onClick={() => choose(option.value)}
						aria-pressed={on === option.value}
						className={`rounded-control px-[13px] py-1.5 text-mono-xs leading-none font-medium transition-colors duration-[90ms] ease-linear ${
							on === option.value ? "bg-control text-text" : "text-text3 hover:text-text2"
						}`}
					>
						{option.label}
					</button>
				))}
			</div>

			<p className="mt-[15px] border-t border-line pt-[13px] text-fine text-pretty text-text3">
				Turning it off forgets the random id this install was counted under, so turning it back on later
				starts a new one. Everything that can ever be sent is listed in PRIVACY.md, and written out in
				full in src/lib/telemetry.ts.
			</p>
		</div>
	);
}
