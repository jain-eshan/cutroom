import { useEffect, useRef } from "react";
import { track } from "./analytics";

// Sign-ups go to a Tally form (tally.so), embedded below. Paste the form's ID
// here: it's the last part of its share link, tally.so/r/<ID>. Until it's set,
// the section says the waitlist isn't open yet rather than showing a broken form.
const TALLY_FORM_ID = "";

const EMBED_SCRIPT = "https://tally.so/widgets/embed.js";

type TallyWindow = Window & { Tally?: { loadEmbeds: () => void } };

/** Reaching the waitlist and filling it in are different things, and the gap
 * between them is the only number here worth acting on. Fired once, when the
 * section is actually on screen -- whether or not the form is open yet, since
 * "got this far" is the same either way. */
function useSeen() {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				track({ name: "waitlist_seen" });
				observer.disconnect();
			},
			{ threshold: 0.4 },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return ref;
}

export function Waitlist() {
	const seen = useSeen();

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

	// The form lives in an iframe, so a submission is only visible as a message
	// from it. Checked against Tally's origin, because any page can post one.
	useEffect(() => {
		if (!TALLY_FORM_ID) return;
		const onMessage = (event: MessageEvent) => {
			if (!event.origin.endsWith("tally.so") || typeof event.data !== "string") return;
			if (event.data.includes("Tally.FormSubmitted")) track({ name: "waitlist_submitted" });
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	if (!TALLY_FORM_ID) {
		return (
			<div ref={seen} className="rounded-marketing border border-line bg-panel p-5 sm:p-6">
				<p className="text-[16px] leading-[1.3] font-semibold tracking-[-0.01em]">The waitlist opens very soon.</p>
				<p className="mt-2 text-[13.5px] leading-[1.6] text-text2">
					Until then,{" "}
					<a
						href="https://github.com/jain-eshan/cutroom"
						target="_blank"
						rel="noopener noreferrer"
						className="font-medium text-accent-text hover:opacity-80"
					>
						star the project on GitHub
						<span className="sr-only"> (opens in a new tab)</span>
					</a>{" "}
					to follow along, or run the developer preview today.
				</p>
			</div>
		);
	}

	return (
		<div ref={seen} className="rounded-marketing border border-line bg-panel p-4 sm:p-6">
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
			<p className="mt-4 px-2 text-[12.5px] leading-[1.6] text-text3">
				Sign-ups are collected with Tally, and we only use your email to invite you to try Cutroom — reply to any
				email from us and we'll remove you. This page counts visits and clicks so we can see what's working; the
				app sends nothing at all unless you turn it on, and never your recording.{" "}
				<a
					href={`https://tally.so/r/${TALLY_FORM_ID}`}
					className="text-accent-text hover:opacity-80"
				>
					Form not showing? Open it here.
				</a>
			</p>
		</div>
	);
}
