import { useEffect } from "react";

// Sign-ups go to a Tally form (tally.so), embedded below. Paste the form's ID
// here: it's the last part of its share link, tally.so/r/<ID>. Until it's set,
// the section says the waitlist isn't open yet rather than showing a broken form.
const TALLY_FORM_ID = "";

const EMBED_SCRIPT = "https://tally.so/widgets/embed.js";

type TallyWindow = Window & { Tally?: { loadEmbeds: () => void } };

export function Waitlist() {
	useEffect(() => {
		if (!TALLY_FORM_ID) return;
		// Tally's script fills in the iframe and keeps its height matched to the form.
		const load = () => (window as TallyWindow).Tally?.loadEmbeds();
		if (document.querySelector(`script[src="${EMBED_SCRIPT}"]`)) {
			load();
			return;
		}
		const script = document.createElement("script");
		script.src = EMBED_SCRIPT;
		script.async = true;
		script.onload = load;
		document.body.appendChild(script);
	}, []);

	if (!TALLY_FORM_ID) {
		return (
			<div className="rounded-[14px] border border-line bg-raised p-6 sm:p-8">
				<p className="text-[18px] font-semibold tracking-[-0.01em]">The waitlist opens very soon.</p>
				<p className="mt-2 text-[15px] leading-relaxed text-text2">
					Until then, star the project on GitHub to follow along, or run the developer preview today.
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-[14px] border border-line bg-raised p-4 sm:p-6">
			<iframe
				data-tally-src={`https://tally.so/embed/${TALLY_FORM_ID}?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1`}
				loading="lazy"
				width="100%"
				height={320}
				title="Join the Cutroom waitlist"
				className="block w-full border-0"
			/>
			<noscript>
				<a href={`https://tally.so/r/${TALLY_FORM_ID}`}>Open the waitlist form</a>
			</noscript>
			<p className="mt-4 px-2 text-[13px] leading-relaxed text-text3">
				Sign-ups are collected with Tally. We only use your email to invite you to try Cutroom, and this site runs no
				analytics of its own. Reply to any email from us and we'll remove you.{" "}
				<a
					href={`https://tally.so/r/${TALLY_FORM_ID}`}
					className="underline decoration-line underline-offset-2 hover:text-text2"
				>
					Form not showing? Open it here.
				</a>
			</p>
		</div>
	);
}
