import { useState } from "react";
import { Logo } from "@/components/Logo";
import { CloseUp, FramingDemo, WideShot } from "./Scene";
import { Waitlist } from "./Waitlist";

const REPO = "https://github.com/jain-eshan/cutroom";
const doc = (path: string) => `${REPO}/blob/main/${path}`;

const SHADOW = "shadow-[0_18px_50px_-24px_rgba(40,30,20,0.35)]";

function Section({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) {
	return (
		<section id={id} className={`px-5 sm:px-8 ${className}`}>
			<div className="mx-auto max-w-[1120px]">{children}</div>
		</section>
	);
}

function Eyebrow({ children }: { children: React.ReactNode }) {
	return <p className="font-mono text-[12px] tracking-[0.08em] text-accent-text uppercase">{children}</p>;
}

/** Anything that leaves the page (GitHub, docs) opens in a new tab, so the
 * landing page stays where the visitor left it. */
function Out({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
	return (
		<a href={href} target="_blank" rel="noopener noreferrer" className={className}>
			{children}
			<span className="sr-only"> (opens in a new tab)</span>
		</a>
	);
}

function GitHubMark() {
	return (
		<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden fill="currentColor" className="shrink-0">
			<path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.13 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.11.16 1.93.08 2.13.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
		</svg>
	);
}

function Nav() {
	return (
		<header className="sticky top-0 z-30 border-b border-line/70 bg-panel/85 backdrop-blur-md">
			<div className="mx-auto flex h-14 max-w-[1120px] items-center gap-3 px-4 sm:h-16 sm:gap-4 sm:px-8">
				<a href="#top" className="flex shrink-0 items-center gap-2.5" aria-label="Cutroom, back to top">
					<Logo size={28} className="text-text" />
					<span className="text-[16px] font-semibold tracking-[-0.01em] sm:text-[17px]">Cutroom</span>
				</a>
				<span className="hidden rounded-full border border-line bg-raised px-2.5 py-0.5 text-[12px] text-text2 sm:inline">
					Developer preview
				</span>
				<nav className="ml-auto hidden items-center gap-6 text-[14px] text-text2 lg:flex">
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
					className="ml-auto flex items-center gap-2 rounded-[9px] border border-line bg-raised px-3 py-1.5 text-[14px] font-medium whitespace-nowrap hover:bg-chrome lg:ml-0"
				>
					<GitHubMark />
					<span>
						Star <span className="hidden sm:inline">on GitHub</span>
					</span>
				</Out>
			</div>
		</header>
	);
}

function Hero() {
	return (
		<Section id="top" className="pt-12 pb-16 sm:pt-16 lg:pt-20">
			<div className="mx-auto max-w-[860px] text-center">
				<p className="mx-auto w-fit rounded-full border border-line bg-raised px-3.5 py-1.5 text-[12px] text-text2 sm:text-[13px]">
					Free and open source · runs on your own computer
				</p>
				<h1 className="mt-6 text-[clamp(2.4rem,7vw,4.25rem)] leading-[1.03] font-semibold tracking-[-0.035em] text-balance">
					Podcast video that cuts itself
				</h1>
				<p className="mx-auto mt-5 max-w-[620px] text-[clamp(1rem,2.1vw,1.2rem)] leading-relaxed text-pretty text-text2">
					Drop in one wide recording of two, three or four people. Cutroom writes the transcript, works out who's
					speaking, and cuts in close on them. Then it hands you every decision to change.
				</p>
				<div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
					<a
						href="#waitlist"
						className="rounded-[10px] bg-handle px-5 py-3 text-[15px] font-medium text-panel hover:opacity-90"
					>
						Join the waitlist
					</a>
					<a
						href="#developer-preview"
						className="rounded-[10px] border border-line bg-raised px-5 py-3 text-[15px] font-medium hover:bg-chrome"
					>
						Run the developer preview
					</a>
				</div>
				<p className="mt-4 text-[13px] text-text3">Free forever · MIT licence · your recording never leaves your machine</p>
			</div>
			{/* Sized so the whole demo, timeline included, fits on screen under the
			    nav on a laptop, rather than filling the width of a large monitor. */}
			<div className="mx-auto mt-12 w-full max-w-[min(800px,calc((100svh_-_280px)*16/9))] sm:mt-14">
				<FramingDemo />
			</div>
		</Section>
	);
}

function Problem() {
	return (
		<Section className="border-y border-line bg-panel py-16 sm:py-20">
			<div className="grid gap-6 md:grid-cols-[1fr_1.3fr] md:gap-16">
				<div>
					<Eyebrow>Why it exists</Eyebrow>
					<h2 className="mt-3 text-[clamp(1.6rem,3.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.025em] text-balance">
						Most shows are one camera and one mixed track
					</h2>
				</div>
				<div className="space-y-4 text-[16px] leading-relaxed text-text2">
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

/**
 * Every feature visual sits in the same frame: a title bar and a 16:10 body.
 * Equal shapes at equal widths make the three feature rows the same height,
 * whatever each one shows.
 */
function Window({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<figure className={`overflow-hidden rounded-[12px] border border-line bg-raised ${SHADOW}`}>
			<div className="flex h-8 items-center gap-1.5 border-b border-line bg-chrome px-3">
				<span className="h-2.5 w-2.5 rounded-full bg-[#e2685c]" />
				<span className="h-2.5 w-2.5 rounded-full bg-[#e6b54c]" />
				<span className="h-2.5 w-2.5 rounded-full bg-[#6cc070]" />
				<span className="ml-2 truncate font-mono text-[11px] text-text3">{title}</span>
			</div>
			<div className="relative aspect-[16/10] overflow-hidden bg-bg">{children}</div>
		</figure>
	);
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="relative overflow-hidden rounded-[6px] bg-black">
			{children}
			<span className="absolute top-1.5 left-1.5 rounded-chip bg-black/55 px-1.5 py-0.5 text-[10px] text-white sm:text-[11px]">
				{label}
			</span>
		</div>
	);
}

function ShotGrid() {
	// Cells are close to 16:10, so the crops ask for that shape; a pane of a
	// two-person shot is half as wide.
	return (
		<div className="grid h-full grid-cols-2 grid-rows-2 gap-2 p-2">
			<Cell label="Close on Maya">
				<CloseUp id="maya" aspect={1.6} className="h-full w-full" />
			</Cell>
			<Cell label="Maya + Dev">
				<div className="flex h-full">
					<CloseUp id="maya" aspect={0.8} className="h-full w-1/2" />
					<CloseUp id="dev" aspect={0.8} className="h-full w-1/2 border-l-2 border-black" />
				</div>
			</Cell>
			<Cell label="Close on Sam">
				<CloseUp id="sam" aspect={1.6} className="h-full w-full" />
			</Cell>
			<Cell label="Wide">
				<WideShot className="h-full w-full" />
			</Cell>
		</div>
	);
}

function Features() {
	const rows = [
		{
			eyebrow: "Automatic framing",
			title: "It cuts to whoever's talking",
			body: "Faces are found and recognised across the whole episode, and each voice is matched to a face by lip movement. Close-ups are framed the way professional podcast edits frame a seated person, and when two people talk over each other, both go on screen.",
			visual: (
				<Window title="Shots">
					<ShotGrid />
				</Window>
			),
		},
		{
			eyebrow: "The editor",
			title: "Every cut is yours to move",
			body: "The suggested shots sit on a timeline beside the transcript. Drag an edge, hold a close-up through an interruption, or clear a shot and go wide. Edges snap to words, the timeline zooms down to a fraction of a second, and everything can be undone.",
			visual: (
				<Window title="ep12_maya_dev_sam.mp4">
					<img
						src="/shots/editor.jpg"
						width={1400}
						height={875}
						loading="lazy"
						decoding="async"
						alt="The Cutroom editor: transcript on the left, video preview on the right, and a framing timeline along the bottom."
						className="h-full w-full object-cover object-top"
					/>
				</Window>
			),
		},
		{
			eyebrow: "The cast",
			title: "You name everyone once",
			body: "Cutroom groups each person's face and guesses which voice belongs to them. You confirm the names one voice at a time, and it tells you which guesses it isn't sure about.",
			visual: (
				<Window title="Who's who">
					<img
						src="/shots/cast.jpg"
						width={1400}
						height={875}
						loading="lazy"
						decoding="async"
						alt="The Cutroom cast screen, asking which person a voice belongs to, with its guess highlighted."
						className="h-full w-full object-cover object-top"
					/>
					{/* The card carries on below the frame; fade it out rather than cut it. */}
					<div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg to-transparent" />
				</Window>
			),
		},
	];
	return (
		<Section className="py-20 sm:py-24 lg:py-28">
			<div className="flex flex-col gap-16 sm:gap-20 lg:gap-24">
				{rows.map((row, i) => (
					<div key={row.title} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
						<div className={`max-w-[560px] ${i % 2 ? "lg:order-2" : ""}`}>
							<Eyebrow>{row.eyebrow}</Eyebrow>
							<h3 className="mt-3 text-[clamp(1.5rem,3.2vw,2.2rem)] leading-tight font-semibold tracking-[-0.025em]">
								{row.title}
							</h3>
							<p className="mt-4 text-[16px] leading-relaxed text-text2">{row.body}</p>
						</div>
						<div className={`w-full max-w-[640px] ${i % 2 ? "lg:order-1" : "lg:justify-self-end"}`}>
							{row.visual}
						</div>
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
		<Section id="how" className="border-y border-line bg-panel py-20 sm:py-24">
			<Eyebrow>How it works</Eyebrow>
			<h2 className="mt-3 max-w-[640px] text-[clamp(1.6rem,3.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.025em]">
				Four steps, all on your own computer
			</h2>
			<ol className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
				{steps.map((step, i) => (
					<li key={step.title} className="flex flex-col rounded-[12px] border border-line bg-raised p-5">
						<span className="font-mono text-[13px] text-accent-text">0{i + 1}</span>
						<p className="mt-3 text-[17px] font-semibold tracking-[-0.01em]">{step.title}</p>
						<p className="mt-2 flex-1 text-[15px] leading-relaxed text-text2">{step.body}</p>
						<p className="mt-4 border-t border-line pt-3 text-[12px] text-text3">{step.tech}</p>
					</li>
				))}
			</ol>
		</Section>
	);
}

function Numbers() {
	const numbers = [
		{ value: "0 bytes", label: "of your recording leave your computer" },
		{ value: "95,436", label: "frames in, and the same 95,436 out, on a 53-minute episode" },
		{ value: "15 min", label: "to process that four-person episode on an Apple silicon Mac" },
		{ value: "$0", label: "and no paid tier above this one" },
	];
	return (
		<Section className="py-20 sm:py-24">
			<div className="grid gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
				{numbers.map((n) => (
					<div key={n.value} className="bg-raised p-5 sm:p-6">
						<p className="font-mono text-[clamp(1.5rem,3vw,2rem)] font-medium tracking-[-0.02em]">{n.value}</p>
						<p className="mt-2 text-[14px] leading-snug text-text2">{n.label}</p>
					</div>
				))}
			</div>
			<p className="mt-4 text-[13px] text-text3">
				Measured on real recordings, not estimated. The method and the rest of the numbers are in{" "}
				<Out href={doc("docs/STATUS.md")} className="underline decoration-line underline-offset-2 hover:text-text">
					STATUS.md
				</Out>
				.
			</p>
		</Section>
	);
}

type Tone = "planned" | "help" | "known" | "later";

const TONE: Record<Tone, string> = {
	planned: "bg-accent/15 text-accent-text",
	help: "bg-s2/12 text-s2",
	known: "bg-warn-bg text-warn",
	later: "bg-control text-text2",
};

function Limits() {
	const rows: { what: string; status: string; tone: Tone; href: string }[] = [
		{ what: "Install without a terminal", status: "Planned: a Mac app", tone: "planned", href: doc("docs/STATUS.md") },
		{ what: "Keep your work if you close the window", status: "Next up", tone: "planned", href: doc("docs/STATUS.md") },
		{
			what: "Stay on the main speaker through a quick “yeah” or “right”",
			status: "Rules written, help wanted",
			tone: "help",
			href: doc("docs/EDGE_CASES.md"),
		},
		{
			what: "Tell four people apart reliably on a long episode",
			status: "Known gap",
			tone: "known",
			href: doc("docs/EDGE_CASES.md"),
		},
		{ what: "Run on Windows or Linux", status: "Untested, help wanted", tone: "help", href: doc("CONTRIBUTING.md") },
		{ what: "Cut short clips for social media", status: "Not started", tone: "later", href: doc("docs/FEATURES.md") },
		{ what: "Handle more than one camera angle", status: "Not planned yet", tone: "later", href: doc("docs/FEATURES.md") },
	];
	return (
		<Section id="limits" className="pb-20 sm:pb-28">
			<div className="grid gap-8 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
				<div>
					<Eyebrow>Honest about it</Eyebrow>
					<h2 className="mt-3 text-[clamp(1.6rem,3.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.025em]">
						What it can't do yet
					</h2>
					<p className="mt-4 max-w-[520px] text-[16px] leading-relaxed text-text2">
						This is early software. Here's where it falls short today, and each one is a good place to help.
					</p>
				</div>
				<ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-raised">
					{rows.map((row) => (
						<li key={row.what}>
							<Out
								href={row.href}
								className="flex flex-col gap-2 px-4 py-4 hover:bg-panel sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5"
							>
								<span className="text-[15px]">{row.what}</span>
								<span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium ${TONE[row.tone]}`}>
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
		<Section id="download" className="py-20 sm:py-24">
			<div className="mx-auto max-w-[640px] text-center">
				<Eyebrow>Download</Eyebrow>
				<h2 className="mt-3 text-[clamp(1.6rem,3.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.025em]">
					Get the app
				</h2>
				<p className="mt-4 text-[16px] leading-relaxed text-text2">
					Mac and Windows builds, no terminal and no cloning the repo. They're brand new and haven't been tried
					outside this repo yet -- if something breaks,{" "}
					<Out
						href={`${REPO}/issues/new/choose`}
						className="underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
					>
						open an issue
					</Out>
					.
				</p>
				<div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
					<Out
						href={`${REPO}/releases/latest/download/Cutroom-0.1.0-arm64.dmg`}
						className="rounded-[10px] bg-handle px-5 py-3 text-[15px] font-medium text-panel hover:opacity-90"
					>
						Download for Mac
					</Out>
					<Out
						href={`${REPO}/releases/latest/download/Cutroom-Setup-0.1.0.exe`}
						className="rounded-[10px] border border-line bg-raised px-5 py-3 text-[15px] font-medium hover:bg-chrome"
					>
						Download for Windows
					</Out>
				</div>
				<p className="mt-4 text-[13px] text-text3">
					The Mac build isn't code-signed, so Gatekeeper will block it on first open -- right-click the app and
					choose Open to run it anyway. ffmpeg is bundled; the app installs everything else it needs on first
					launch.
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
		<Section id="developer-preview" className="border-y border-line bg-panel py-20 sm:py-24">
			{/* min-w-0 on both columns: a grid item won't shrink below its widest
			    content otherwise, and the long clone command pushed the page wider
			    than a phone screen. */}
			<div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
				<div className="min-w-0">
					<Eyebrow>Developer preview</Eyebrow>
					<h2 className="mt-3 text-[clamp(1.6rem,3.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.025em]">
						Run it today
					</h2>
					<p className="mt-4 max-w-[560px] text-[16px] leading-relaxed text-text2">
						If you're comfortable in a terminal, you can run the whole thing now. One command starts the app and its
						local processing service, and the app walks you through the rest.
					</p>
					<ul className="mt-6 max-w-[560px] space-y-3 text-[15px] leading-relaxed text-text2">
						{[
							<>A Mac with Apple silicon. It's the only setup tested so far.</>,
							<>
								<span className="text-text">Node.js 22.18 or newer</span> and <span className="text-text">uv</span>.
								uv installs the right Python for you.
							</>,
							<>
								<span className="text-text">ffmpeg</span>. Install <span className="font-mono text-[13px]">ffmpeg-full</span>{" "}
								from Homebrew if you want burned-in captions.
							</>,
							<>A free Hugging Face account. The app asks for a token on first run and links you to where to get one.</>,
							<>About 3 GB of disk for models and packages, and a few minutes for the first start.</>,
						].map((item, i) => (
							<li key={i} className="flex gap-3">
								<span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
								<span>{item}</span>
							</li>
						))}
					</ul>
					<Out
						href={`${REPO}#readme`}
						className="mt-7 inline-block text-[15px] font-medium text-accent-text underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
					>
						Read the full setup guide
					</Out>
				</div>

				<div className="min-w-0 self-center">
					<div className="overflow-hidden rounded-[12px] bg-terminal shadow-[0_24px_60px_-28px_rgba(0,0,0,0.6)]">
						<div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
							<span className="font-mono text-[12px] text-white/50">Terminal</span>
							<button
								type="button"
								onClick={copy}
								className="rounded-[6px] border border-white/15 px-2.5 py-1 font-mono text-[11px] text-white/70 hover:bg-white/10"
							>
								{copied ? "Copied" : "Copy"}
							</button>
						</div>
						<pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-7 text-white/90 sm:p-5 sm:text-[13.5px]">
							{COMMANDS.map((c) => (
								<div key={c}>
									<span className="text-accent select-none">$ </span>
									{c}
								</div>
							))}
							<div className="text-white/40"># then open http://localhost:3460</div>
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
		<Section id="contribute" className="py-20 sm:py-28">
			<div className="max-w-[680px]">
				<Eyebrow>Contribute</Eyebrow>
				<h2 className="mt-3 text-[clamp(1.6rem,3.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.025em]">
					Built in the open. Come help.
				</h2>
				<p className="mt-4 text-[16px] leading-relaxed text-text2">
					The hard problems here are real ones: telling voices apart on one mixed track, matching them to faces, and
					deciding when a cut is worth making. If any of that sounds fun, there's a clear place to start.
				</p>
			</div>
			<div className="mt-10 grid gap-4 md:grid-cols-2">
				{cards.map((card) => (
					<Out
						key={card.title}
						href={card.href}
						className="group rounded-[12px] border border-line bg-raised p-5 transition-colors hover:border-text3"
					>
						<span className="flex items-center justify-between gap-4 text-[17px] font-semibold tracking-[-0.01em]">
							{card.title}
							<span className="text-text3 transition-transform group-hover:translate-x-0.5" aria-hidden>
								↗
							</span>
						</span>
						<span className="mt-2 block text-[15px] leading-relaxed text-text2">{card.body}</span>
					</Out>
				))}
			</div>
		</Section>
	);
}

function WaitlistSection() {
	return (
		<Section id="waitlist" className="border-t border-line bg-panel py-20 sm:py-24">
			<div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
				<div>
					<Eyebrow>Waitlist</Eyebrow>
					<h2 className="mt-3 text-[clamp(1.6rem,3.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.025em] text-balance">
						Try it on your own episode
					</h2>
					<p className="mt-4 max-w-[560px] text-[16px] leading-relaxed text-text2">
						We're looking for podcast hosts who record on one camera to try Cutroom on a real episode, and tell us
						where the edit falls short. We'll write when there's a version you can install without a terminal.
					</p>
				</div>
				<Waitlist />
			</div>
		</Section>
	);
}

function Closing() {
	return (
		<section className="bg-terminal px-5 py-20 text-white sm:px-8 sm:py-24">
			<div className="mx-auto max-w-[820px] text-center">
				<p className="text-[clamp(1.3rem,3.2vw,2.1rem)] leading-snug font-medium tracking-[-0.02em] text-balance">
					Free, because the expensive parts (the GPU, the storage, the render) are already on your desk. There's
					nothing to host, so there's nothing to charge for.
				</p>
				<div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
					<a
						href="#waitlist"
						className="rounded-[10px] bg-accent px-5 py-3 text-[15px] font-semibold text-on-accent hover:brightness-105"
					>
						Join the waitlist
					</a>
					<Out
						href={REPO}
						className="flex items-center justify-center gap-2 rounded-[10px] border border-white/20 px-5 py-3 text-[15px] font-medium hover:bg-white/10"
					>
						<GitHubMark />
						Star on GitHub
					</Out>
				</div>
			</div>
		</section>
	);
}

function Footer() {
	return (
		<footer className="px-5 py-10 sm:px-8">
			<div className="mx-auto flex max-w-[1120px] flex-col gap-6 text-[13px] text-text3 lg:flex-row lg:items-start lg:justify-between">
				<div className="flex items-center gap-2.5">
					<Logo size={22} className="text-text" />
					<span>Cutroom · MIT licence</span>
				</div>
				<p className="max-w-[560px] leading-relaxed">
					Built on faster-whisper, pyannote community-1 (CC BY 4.0), OpenCV's YuNet and SFace, LR-ASD and FFmpeg. See{" "}
					<Out href={`${REPO}#credits`} className="underline decoration-line underline-offset-2 hover:text-text2">
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
		<div className="min-h-screen overflow-x-clip bg-bg text-text">
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
