import { useState } from "react";
import { Logo } from "@/components/Logo";
import { track } from "./analytics";
import { AutoFramingLoop, FramingDemo } from "./Scene";
import { Waitlist } from "./Waitlist";

const REPO = "https://github.com/jain-eshan/cutroom";
const doc = (path: string) => `${REPO}/blob/main/${path}`;

// Button recipes from the design system's site kit. The accent is the page's
// one accent action (joining the waitlist, in the hero); everything else is
// the dark or the quiet button.
const BTN =
	"inline-flex items-center justify-center rounded-marketing px-[22px] py-[15px] text-[14px] leading-none font-medium whitespace-nowrap transition-[background-color,opacity] duration-[90ms] ease-linear";
const PRIMARY = `${BTN} bg-accent font-semibold text-on-accent hover:opacity-90`;
const DARK = `${BTN} bg-text text-bg hover:bg-text2`;
const QUIET = `${BTN} border border-line bg-raised text-text hover:bg-chrome`;
// The system has no underlined links.
const LINK = "text-accent-text hover:opacity-80";

const H2 = "text-[25px] leading-[1.25] font-semibold tracking-[-0.02em] text-balance";
const PROSE = "text-[15px] leading-[1.65] text-text2";

/** A full-width band. `raised` alternates the ground, the way the kit does. */
function Section({
	id,
	raised = false,
	className = "",
	children,
}: {
	id?: string;
	raised?: boolean;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<section
			id={id}
			className={`border-t border-line px-4 py-[44px] sm:px-[34px] sm:py-[52px] ${raised ? "bg-raised" : ""} ${className}`}
		>
			<div className="mx-auto max-w-[1040px]">{children}</div>
		</section>
	);
}

/** Anything that leaves the page (GitHub, docs) opens in a new tab, so the
 * landing page stays where the visitor left it. `onClick` is for the few
 * links that are an outcome rather than a detour -- a download, a star. */
function Out({
	href,
	className,
	onClick,
	children,
}: {
	href: string;
	className?: string;
	onClick?: () => void;
	children: React.ReactNode;
}) {
	return (
		<a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} className={className}>
			{children}
			<span className="sr-only"> (opens in a new tab)</span>
		</a>
	);
}

function Nav() {
	return (
		<header className="sticky top-0 z-30 border-b border-line bg-panel">
			<div className="mx-auto flex h-14 max-w-[1040px] items-center gap-3 px-4 sm:h-16 sm:gap-4 sm:px-[34px]">
				<a href="#top" className="flex shrink-0 items-center gap-2.5" aria-label="Cutroom, back to top">
					<Logo size={26} className="text-text" />
					<span className="text-[16px] font-semibold tracking-[-0.01em]">Cutroom</span>
				</a>
				<span className="hidden rounded-[20px] border border-line bg-raised px-2.5 py-1 text-[11.5px] leading-none text-text2 sm:inline">
					Developer preview
				</span>
				<nav className="ml-auto hidden items-center gap-5 text-[12.5px] text-text2 lg:flex">
					<a href="#how" className="hover:text-text">
						How it works
					</a>
					<a href="#limits" className="hover:text-text">
						What it can't do yet
					</a>
					<a href="#contribute" className="hover:text-text">
						Contribute
					</a>
					<a href="#download" className="hover:text-text">
						Download
					</a>
					<a href="#waitlist" className="hover:text-text">
						Waitlist
					</a>
				</nav>
				<Out
					href={REPO}
					onClick={() => track({ name: "repo_opened" })}
					className="ml-auto rounded-[8px] bg-text px-[13px] py-2 text-[12.5px] leading-none font-medium whitespace-nowrap text-bg transition-colors duration-[90ms] ease-linear hover:bg-text2 lg:ml-0"
				>
					Star on GitHub
				</Out>
			</div>
		</header>
	);
}

function Hero() {
	return (
		<section id="top" className="px-4 pt-[44px] pb-[52px] text-center sm:px-[34px] sm:pt-[52px]">
			<div className="mx-auto max-w-[1040px]">
				<p className="mx-auto w-fit rounded-[20px] border border-line bg-raised px-[13px] py-[7px] text-[11.5px] leading-none text-text2">
					Free and open source · runs on your own computer
				</p>
				<h1 className="mx-auto mt-5 max-w-[760px] text-[48px] leading-[1.06] font-semibold tracking-[-0.035em] text-balance sm:text-[52px]">
					Podcast video that cuts itself
				</h1>
				<p className="mx-auto mt-5 max-w-[560px] text-[17px] leading-[27px] text-pretty text-text2">
					Drop in one wide recording of two, three or four people. Cutroom writes the transcript, works out who's
					speaking, and cuts in close on them. Then it hands you every decision to change.
				</p>
				<div className="mt-6 flex flex-col justify-center gap-[11px] sm:flex-row">
					<a href="#waitlist" className={PRIMARY}>
						Join the waitlist
					</a>
					<a href="#developer-preview" className={QUIET}>
						Run the developer preview
					</a>
				</div>
				<p className="mt-5 text-[12.5px] leading-[1.5] text-text3">
					Free forever · MIT licence · your recording never leaves your machine
				</p>
				{/* Sized so the whole demo, timeline included, fits on screen under the
				    nav on a laptop, rather than filling a large monitor. */}
				<div className="mx-auto mt-[44px] w-full max-w-[min(840px,calc((100svh_-_280px)*16/9))]">
					<FramingDemo />
				</div>
			</div>
		</section>
	);
}

function Problem() {
	return (
		<Section raised>
			<div className="grid gap-6 md:grid-cols-[0.85fr_1.15fr] md:gap-10">
				<h2 className={H2}>Most shows are one camera and one mixed track</h2>
				<div className={`space-y-4 ${PROSE}`}>
					<p>
						The tools that edit podcast video automatically assume a studio: a microphone and a camera for every
						person, so the software can tell who's talking by checking which track is loud.
					</p>
					<p>
						A camera on a table, a phone, or a Zoom call gives you none of that. Someone ends up cutting it by hand,
						for hours, or the video never gets made.
					</p>
					<p className="text-text">
						Cutroom works out who's talking from the recording itself: whose voice it is, and whose lips are moving.
					</p>
				</div>
			</div>
		</Section>
	);
}

/** The kit's FeatureBlock: a 16:10 clip, a title, a paragraph. */
function Features() {
	const shot = (src: string, alt: string) => (
		<img
			src={src}
			width={1400}
			height={875}
			loading="lazy"
			decoding="async"
			alt={alt}
			className="h-full w-full object-cover object-top"
		/>
	);
	const blocks = [
		{
			title: "It cuts to whoever's talking",
			body: "Faces are found and recognised across the whole episode, and each voice is matched to a face by lip movement. Close-ups are framed the way professional podcast edits frame a seated person, and when two people talk over each other, both go on screen.",
			clip: <AutoFramingLoop />,
		},
		{
			title: "Every cut is yours to move",
			body: "The suggested shots sit on a timeline beside the transcript. Drag an edge, hold a close-up through an interruption, or clear a shot and go wide. Edges snap to words, the timeline zooms down to a fraction of a second, and everything can be undone.",
			clip: shot(
				"/shots/editor.jpg",
				"The Cutroom editor: transcript on the left, video preview on the right, and a framing timeline along the bottom.",
			),
		},
		{
			title: "You name everyone once",
			body: "Cutroom groups each person's face and guesses which voice belongs to them. You confirm the names one voice at a time, and it tells you which guesses it isn't sure about.",
			clip: shot(
				"/shots/cast.jpg",
				"The Cutroom cast screen, asking which person a voice belongs to, with its guess highlighted.",
			),
		},
	];
	return (
		<Section>
			<div className="grid gap-[34px] md:grid-cols-3 md:gap-[26px]">
				{blocks.map((b) => (
					<div key={b.title} className="flex flex-col gap-[13px]">
						<div className="aspect-[16/10] overflow-hidden rounded-marketing border border-line bg-bg">{b.clip}</div>
						<h3 className="text-[16px] leading-[1.3] font-semibold tracking-[-0.01em]">{b.title}</h3>
						<p className="text-[13.5px] leading-[1.6] text-pretty text-text2">{b.body}</p>
					</div>
				))}
			</div>
		</Section>
	);
}

function HowItWorks() {
	const steps = [
		{
			title: "Drop in a recording",
			body: "A video from a camera, a phone or a Zoom call. It's read from your disk, not uploaded anywhere.",
			tech: "Any format ffmpeg reads",
		},
		{
			title: "It listens and looks",
			body: "A transcript with a timing for every word, who speaks when, and every face in the frame.",
			tech: "faster-whisper · pyannote · OpenCV YuNet and SFace",
		},
		{
			title: "It matches voices to faces",
			body: "A lip-sync model checks whose mouth moves with each voice. You confirm the names.",
			tech: "LR-ASD · Hungarian matching",
		},
		{
			title: "You adjust, it renders",
			body: "Change any shot, then export an MP4 at the source resolution. The audio is copied through untouched.",
			tech: "ffmpeg",
		},
	];
	return (
		<Section id="how" raised>
			<h2 className={H2}>Four steps, all on your own computer</h2>
			<ol className="mt-[26px] grid gap-[13px] sm:grid-cols-2 lg:grid-cols-4">
				{steps.map((step, i) => (
					<li key={step.title} className="flex flex-col rounded-marketing border border-line bg-panel p-5">
						<span className="text-[12.5px] font-medium text-text3">Step {i + 1}</span>
						<p className="mt-2 text-[16px] leading-[1.3] font-semibold tracking-[-0.01em]">{step.title}</p>
						<p className="mt-2 flex-1 text-[13.5px] leading-[1.6] text-text2">{step.body}</p>
						<p className="mt-4 border-t border-line pt-3 text-[11.5px] leading-[1.5] text-text3">{step.tech}</p>
					</li>
				))}
			</ol>
		</Section>
	);
}

/** The kit's ProofStat row. Every value comes from docs/STATUS.md. */
function Numbers() {
	const numbers = [
		{ value: "0 bytes", label: "of your recording leave your computer" },
		{ value: "95,436", label: "frames in, and the same 95,436 out, on a 53-minute episode" },
		{ value: "15 min", label: "to process that four-person episode on an Apple silicon Mac" },
		{ value: "$0", label: "and no paid tier above this one" },
	];
	return (
		<Section>
			<div className="grid grid-cols-2 gap-x-4 gap-y-[34px] text-center lg:grid-cols-4">
				{numbers.map((n) => (
					<div key={n.value}>
						<p className="font-mono text-[26px] leading-none text-text">{n.value}</p>
						<p className="mx-auto mt-[7px] max-w-[220px] text-[12.5px] leading-[1.4] text-text2">{n.label}</p>
					</div>
				))}
			</div>
			<p className="mt-[34px] text-center text-[12.5px] leading-[1.5] text-text3">
				Measured on real recordings, not estimated. The method and the rest of the numbers are in{" "}
				<Out href={doc("docs/STATUS.md")} className={LINK}>
					STATUS.md
				</Out>
				.
			</p>
		</Section>
	);
}

/** The kit's "What it can't do yet" table. The credibility block and the
 * contributor funnel: keep it. */
function Limits() {
	const rows = [
		{
			what: "Stay on the main speaker through a quick “yeah” or “right”",
			status: "Rules written, help wanted",
			help: true,
			href: doc("docs/EDGE_CASES.md"),
		},
		{
			what: "Tell four people apart reliably on a long episode",
			status: "Known gap",
			help: false,
			href: doc("docs/EDGE_CASES.md"),
		},
		{ what: "Run on Windows or Linux", status: "Untested, help wanted", help: true, href: doc("CONTRIBUTING.md") },
		{ what: "Cut short clips for social media", status: "Not started", help: false, href: doc("docs/FEATURES.md") },
		{ what: "Handle more than one camera angle", status: "Not planned yet", help: false, href: doc("docs/FEATURES.md") },
	];
	return (
		<Section id="limits" raised>
			<div className="grid gap-[26px] lg:grid-cols-[0.85fr_1.15fr] lg:gap-10">
				<div>
					<h2 className={H2}>What it can't do yet</h2>
					<p className={`mt-3 max-w-[460px] ${PROSE}`}>
						This is early software. Here's where it falls short today, and each one is a good place to help.
					</p>
				</div>
				<ul className="flex flex-col gap-px overflow-hidden rounded-marketing border border-line bg-line">
					{rows.map((row) => (
						<li key={row.what}>
							<Out
								href={row.href}
								className="flex flex-col gap-1 bg-panel px-4 py-[13px] transition-colors duration-[90ms] ease-linear hover:bg-chrome sm:flex-row sm:items-center sm:justify-between sm:gap-[14px]"
							>
								<span className="text-[13.5px] leading-[1.4] text-text">{row.what}</span>
								<span
									className={`shrink-0 text-[12.5px] font-medium ${row.help ? "text-accent-text" : "text-text3"}`}
								>
									{row.status}
								</span>
							</Out>
						</li>
					))}
				</ul>
			</div>
		</Section>
	);
}

const COMMANDS = ["git clone https://github.com/jain-eshan/cutroom.git", "cd cutroom", "npm install", "npm run dev"];

function Download() {
	return (
		<Section id="download">
			<div className="mx-auto max-w-[640px] text-center">
				<h2 className={H2}>Get the app</h2>
				<p className={`mt-3 ${PROSE}`}>
					Mac and Windows builds, no terminal and no cloning the repo. They're brand new and haven't been tried
					outside this repo yet. If something breaks,{" "}
					<Out href={`${REPO}/issues/new/choose`} className={LINK}>
						open an issue
					</Out>
					.
				</p>
				<div className="mt-6 flex flex-col justify-center gap-[11px] sm:flex-row">
					<Out
						href={`${REPO}/releases/latest/download/Cutroom-arm64.dmg`}
						className={DARK}
						onClick={() => track({ name: "download_clicked", platform: "mac" })}
					>
						Download for Mac
					</Out>
					<Out
						href={`${REPO}/releases/latest/download/Cutroom-Setup.exe`}
						className={QUIET}
						onClick={() => track({ name: "download_clicked", platform: "windows" })}
					>
						Download for Windows
					</Out>
				</div>
				<p className="mt-5 text-[12.5px] leading-[1.6] text-text3">
					The Mac build isn't notarized by Apple, so macOS will block it the first time you open it. Go to{" "}
					<span className="text-text">System Settings → Privacy &amp; Security</span>, scroll to the bottom, and
					click <span className="text-text">Open Anyway</span> next to Cutroom, then open the app again and
					confirm. ffmpeg is bundled; the app installs everything else it needs on first launch.
				</p>
			</div>
		</Section>
	);
}

function DeveloperPreview() {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(COMMANDS.join("\n"));
			setCopied(true);
			setTimeout(() => setCopied(false), 1800);
		} catch {
			// Clipboard blocked: the commands are still selectable on screen.
		}
	}

	return (
		<Section id="developer-preview" raised>
			{/* min-w-0 on both columns: a grid item won't shrink below its widest
			    content otherwise, and the long clone command pushed the page wider
			    than a phone screen. */}
			<div className="grid gap-[34px] lg:grid-cols-2 lg:gap-10">
				<div className="min-w-0">
					<h2 className={H2}>Run it today</h2>
					<p className={`mt-3 max-w-[560px] ${PROSE}`}>
						If you're comfortable in a terminal, you can run the whole thing now. One command starts the app and its
						local processing service, and the app walks you through the rest.
					</p>
					<ul className="mt-5 max-w-[560px] space-y-[9px] text-[13.5px] leading-[1.6] text-text2">
						{[
							<>A Mac with Apple silicon. It's the only setup tested so far.</>,
							<>
								<span className="text-text">Node.js 22.18 or newer</span> and <span className="text-text">uv</span>.
								uv installs the right Python for you.
							</>,
							<>
								<span className="text-text">ffmpeg</span>. Install <span className="font-mono text-[12.5px]">ffmpeg-full</span>{" "}
								from Homebrew if you want burned-in captions.
							</>,
							<>About 3 GB of disk for models and packages, and a few minutes for the first start.</>,
						].map((item, i) => (
							<li key={i} className="flex gap-3">
								<span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-text3" />
								<span>{item}</span>
							</li>
						))}
					</ul>
					<Out href={`${REPO}#readme`} className={`mt-6 inline-block text-[14px] font-medium ${LINK}`}>
						Read the full setup guide
					</Out>
				</div>

				<div className="min-w-0 self-center">
					<div className="overflow-hidden rounded-marketing bg-terminal">
						<div className="flex items-center justify-between border-b border-plate-a px-4 py-2.5">
							<span className="text-[11.5px] text-plate-ink">Terminal</span>
							<button
								type="button"
								onClick={copy}
								className="rounded-[6px] border border-plate-a px-2.5 py-1 text-[11.5px] leading-none text-plate-ink transition-colors duration-[90ms] ease-linear hover:bg-plate-b"
							>
								{copied ? "Copied" : "Copy"}
							</button>
						</div>
						<pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-7 text-plate-ink sm:p-5">
							{COMMANDS.map((c) => (
								<div key={c}>
									<span className="text-accent select-none">$ </span>
									{c}
								</div>
							))}
							<div># then open http://localhost:3460</div>
						</pre>
					</div>
				</div>
			</div>
		</Section>
	);
}

function Contribute() {
	const cards = [
		{
			title: "Contributing guide",
			body: "How the code is laid out, how to run the tests, and how to send a change.",
			href: doc("CONTRIBUTING.md"),
		},
		{
			title: "Framing edge cases",
			body: "45 situations where the automatic edit goes wrong, each with what it should do instead.",
			href: doc("docs/EDGE_CASES.md"),
		},
		{
			title: "Architecture",
			body: "How a recording moves through transcription, speaker detection, faces and the render.",
			href: doc("docs/ARCHITECTURE.md"),
		},
		{
			title: "Report a recording it got wrong",
			body: "The single most useful bug report. Tell us what the edit did and what it should have done.",
			href: `${REPO}/issues/new/choose`,
		},
	];
	return (
		<Section id="contribute">
			<div className="max-w-[640px]">
				<h2 className={H2}>Built in the open. Come help.</h2>
				<p className={`mt-3 ${PROSE}`}>
					The hard problems here are real ones: telling voices apart on one mixed track, matching them to faces, and
					deciding when a cut is worth making. If any of that sounds fun, there's a clear place to start.
				</p>
			</div>
			<div className="mt-[26px] grid gap-[13px] md:grid-cols-2">
				{cards.map((card) => (
					<Out
						key={card.title}
						href={card.href}
						className="rounded-marketing border border-line bg-raised p-5 transition-colors duration-[90ms] ease-linear hover:bg-chrome"
					>
						<span className="flex items-center justify-between gap-4 text-[16px] leading-[1.3] font-semibold tracking-[-0.01em]">
							{card.title}
							<span className="text-text3" aria-hidden>
								↗
							</span>
						</span>
						<span className="mt-2 block text-[13.5px] leading-[1.6] text-text2">{card.body}</span>
					</Out>
				))}
			</div>
		</Section>
	);
}

function WaitlistSection() {
	return (
		<Section id="waitlist" raised>
			<div className="grid gap-[26px] lg:grid-cols-[1fr_1.1fr] lg:gap-10">
				<div>
					<h2 className={H2}>Try it on your own episode</h2>
					<p className={`mt-3 max-w-[560px] ${PROSE}`}>
						We're looking for podcast hosts who record on one camera to try Cutroom on a real episode, and tell us
						where the edit falls short. Download it above, or leave your email and we'll follow up.
					</p>
				</div>
				<Waitlist />
			</div>
		</Section>
	);
}

/** The kit's closing line. The waitlist form sits right above it, so the
 * buttons point elsewhere and the hero keeps the page's one accent action. */
function Closing() {
	return (
		<Section>
			<div className="flex flex-col gap-[26px] lg:flex-row lg:items-center lg:justify-between">
				<p className="max-w-[540px] text-[15px] leading-[1.55] text-pretty text-text2">
					Free, because the expensive parts (the GPU, the storage, the render) are already on your desk. There's
					nothing to host, so there's nothing to charge for.
				</p>
				<div className="flex flex-col gap-[10px] sm:flex-row">
					<Out
						href={`${REPO}/releases/latest/download/Cutroom-arm64.dmg`}
						className={DARK}
						onClick={() => track({ name: "download_clicked", platform: "mac" })}
					>
						Download for Mac
					</Out>
					<Out href={REPO} className={QUIET} onClick={() => track({ name: "repo_opened" })}>
						Star on GitHub
					</Out>
				</div>
			</div>
		</Section>
	);
}

function Footer() {
	return (
		<footer className="border-t border-line px-4 py-[34px] sm:px-[34px]">
			<div className="mx-auto flex max-w-[1040px] flex-col gap-6 text-[12.5px] text-text3 lg:flex-row lg:items-start lg:justify-between">
				<div className="flex items-center gap-2.5">
					<Logo size={20} className="text-text" />
					<span>Cutroom · MIT licence</span>
				</div>
				<p className="max-w-[560px] leading-[1.6]">
					Built on faster-whisper, pyannote community-1 (CC BY 4.0), OpenCV's YuNet and SFace, LR-ASD and FFmpeg. See{" "}
					<Out href={`${REPO}#credits`} className={LINK}>
						credits
					</Out>
					.
				</p>
				<nav className="flex flex-wrap gap-x-5 gap-y-2">
					<Out href={REPO} className="hover:text-text2">
						GitHub
					</Out>
					<Out href={doc("CONTRIBUTING.md")} className="hover:text-text2">
						Contributing
					</Out>
					<Out href={doc("docs/README.md")} className="hover:text-text2">
						Docs
					</Out>
				</nav>
			</div>
		</footer>
	);
}

export function Landing() {
	return (
		<div className="min-h-screen overflow-x-clip bg-panel text-text">
			<a
				href="#waitlist"
				className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-raised focus:px-3 focus:py-2"
			>
				Skip to the waitlist
			</a>
			<Nav />
			<main>
				<Hero />
				<Problem />
				<Features />
				<HowItWorks />
				<Numbers />
				<Limits />
				<Download />
				<DeveloperPreview />
				<Contribute />
				<WaitlistSection />
				<Closing />
			</main>
			<Footer />
		</div>
	);
}
