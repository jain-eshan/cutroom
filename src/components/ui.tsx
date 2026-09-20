/**
 * The design system's primitives (its `components/` folder), ported to
 * Tailwind against the tokens in index.css. Every screen builds from these
 * rather than writing its own button or label recipe -- that drift is what
 * docs/design/handoff/Screen Audit.dc.html found on every screen.
 *
 * No icon set, on purpose: play, pause, arrows and the upload glyph are CSS
 * shapes, and the check is the literal character in Instrument Sans 700.
 */
import { useState } from "react";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { Logo } from "@/components/Logo";
import { CreditsSheet } from "@/components/Credits";
import { hasElectronBridge, openDownloadPage, restartToUpdate, useUpdateState } from "@/lib/electron";
import type { ThemeMode } from "@/lib/theme";

type Variant = "primary" | "secondary" | "quiet" | "ghost" | "destructive" | "inert";
type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, string> = {
	sm: "px-[11px] py-[7px] text-mono-sm leading-none font-medium rounded-control",
	md: "px-[15px] py-[11px] text-meta leading-none font-medium rounded-control-lg",
	lg: "px-5 py-[13px] text-ui leading-none font-semibold rounded-control-lg",
};

const VARIANTS: Record<Variant, string> = {
	// One per screen.
	primary: "bg-accent text-on-accent font-semibold border-transparent",
	secondary: "bg-control text-text border-transparent",
	quiet: "bg-raised text-text2 border-line hover:bg-control",
	// Replaces every underlined text link: the system has none.
	ghost: "!p-0 bg-transparent text-accent-text border-transparent hover:text-accent",
	destructive: "bg-transparent text-warn border-warn-edge",
	// Deliberately dead, at full opacity: there is nothing correct to click
	// yet. Not the same as disabled, which is 50% on something that will be.
	inert: "bg-control text-text3 border-transparent cursor-default",
};

function buttonClass(variant: Variant = "secondary", size: Size = "md", full = false): string {
	return `inline-flex items-center justify-center gap-[7px] border whitespace-nowrap text-center transition-[background-color,opacity] duration-[90ms] ease-linear disabled:cursor-default disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${full ? "w-full" : ""}`;
}

export function Button({
	variant = "secondary",
	size = "md",
	full = false,
	className = "",
	onClick,
	...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; full?: boolean }) {
	return (
		<button
			type="button"
			{...rest}
			onClick={variant === "inert" ? undefined : onClick}
			aria-disabled={variant === "inert" || undefined}
			className={`${buttonClass(variant, size, full)} ${className}`}
		/>
	);
}

/** A Button that is really a link -- a download, say. */
export function ButtonLink({
	variant = "secondary",
	size = "md",
	className = "",
	...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
	return <a {...rest} className={`${buttonClass(variant, size)} ${className}`} />;
}

/** The uppercase mono micro-label. The only uppercase in the product. */
export function SectionLabel({ className = "", children }: { className?: string; children: React.ReactNode }) {
	return (
		<span className={`font-mono text-label font-semibold tracking-[0.08em] text-text3 uppercase ${className}`}>
			{children}
		</span>
	);
}

/** A CSS border triangle in the current text colour. */
export function Triangle({ direction, size = 5 }: { direction: "up" | "down" | "left" | "right"; size?: number }) {
	const half = `${size * 0.7}px solid transparent`;
	const solid = `${size}px solid currentColor`;
	const style: React.CSSProperties =
		direction === "left" || direction === "right"
			? { borderTop: half, borderBottom: half, [direction === "right" ? "borderLeft" : "borderRight"]: solid }
			: { borderLeft: half, borderRight: half, [direction === "down" ? "borderTop" : "borderBottom"]: solid };
	return <span aria-hidden="true" className="block h-0 w-0" style={style} />;
}

/** Play is a border triangle in an accent circle; pause is two 3px bars. */
export function PlayButton({
	playing = false,
	size = 32,
	label,
	className = "",
	...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { playing?: boolean; size?: number; label?: string }) {
	const t = Math.round(size * 0.28);
	return (
		<button
			type="button"
			aria-label={label ?? (playing ? "Pause" : "Play")}
			{...rest}
			style={{ width: size, height: size }}
			className={`flex shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:cursor-default disabled:opacity-50 ${className}`}
		>
			{playing ? (
				<span aria-hidden="true" className="flex gap-[3px]">
					<span className="block w-[3px] rounded-[1px] bg-current" style={{ height: t * 1.3 }} />
					<span className="block w-[3px] rounded-[1px] bg-current" style={{ height: t * 1.3 }} />
				</span>
			) : (
				<span
					aria-hidden="true"
					className="block h-0 w-0"
					style={{
						marginLeft: Math.round(size * 0.09),
						borderLeft: `${t}px solid currentColor`,
						borderTop: `${t * 0.61}px solid transparent`,
						borderBottom: `${t * 0.61}px solid transparent`,
					}}
				/>
			)}
		</button>
	);
}

/** The square check mark used by artefact rows and toggles. */
export function CheckMark({ checked, size = 17 }: { checked: boolean; size?: number }) {
	return (
		<span
			aria-hidden="true"
			style={{ width: size, height: size }}
			className={`flex shrink-0 items-center justify-center rounded-[4px] border font-sans text-[11px] leading-none font-bold text-on-accent ${
				checked ? "border-accent bg-accent" : "border-text3 bg-transparent"
			}`}
		>
			{checked ? "✓" : ""}
		</span>
	);
}

/** One thing the machine needs, with its state carried by the ring. */
export function StatusRow({
	state,
	title,
	detail,
	optional = false,
	children,
}: {
	state: "ok" | "active" | "pending";
	title: string;
	detail?: React.ReactNode;
	/** 60%: a dependency the app works without. */
	optional?: boolean;
	children?: React.ReactNode;
}) {
	return (
		<div
			className={`flex flex-col gap-[11px] rounded-card border bg-chrome px-[14px] ${
				state === "active" ? "border-accent-edge pt-[13px] pb-[14px]" : "border-line py-3"
			} ${optional ? "opacity-60" : ""}`}
		>
			<div className="flex items-center gap-[11px]">
				<span
					className={`flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full font-sans text-[11px] leading-none font-bold text-on-accent ${
						state === "ok" ? "bg-ok" : state === "active" ? "border-2 border-accent" : "border-2 border-text3"
					}`}
				>
					{state === "ok" ? "✓" : ""}
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="text-ui leading-[1.3] font-semibold text-text">{title}</span>
					{detail && <span className="font-mono text-mono-sm text-text3">{detail}</span>}
				</span>
			</div>
			{children}
		</div>
	);
}

/** A pipeline stage. Only the active one carries a bar; done is a filled ok
 * dot, pending a ring at 50%. No pulse for the indeterminate case -- the
 * elapsed clock is the honest signal. */
export function StageRow({
	label,
	state,
	fraction = 0,
}: {
	label: string;
	state: "done" | "active" | "pending";
	fraction?: number;
}) {
	const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
	return (
		<div
			className={`grid grid-cols-[9px_minmax(0,1fr)_46px] items-center gap-[11px] ${state === "pending" ? "opacity-50" : ""}`}
		>
			<span
				className={`h-[9px] w-[9px] rounded-full border ${
					state === "done" ? "border-ok bg-ok" : state === "active" ? "border-accent bg-accent" : "border-text3"
				}`}
			/>
			<span className="flex min-w-0 flex-col gap-1.5">
				<span className={`text-ui font-medium ${state === "active" ? "text-text" : "text-text3"}`}>{label}</span>
				{state === "active" && (
					<span className="block h-[6px] overflow-hidden rounded-[3px] bg-track">
						<span
							className="block h-full rounded-[3px] bg-accent transition-[width] duration-[240ms] ease-linear"
							style={{ width: `${percent}%` }}
						/>
					</span>
				)}
			</span>
			<span className={`justify-self-end font-mono text-mono-sm leading-none ${state === "active" ? "text-text2" : "text-text3"}`}>
				{state === "done" ? "done" : state === "active" ? `${percent}%` : "—"}
			</span>
		</div>
	);
}

/** A raw machine string, in the terminal well -- always under the plain
 * English line, never instead of it, so it can be pasted into an issue. */
export function RawMessage({ children, className = "" }: { children: React.ReactNode; className?: string }) {
	return (
		<code
			className={`block rounded-control border border-line bg-terminal px-[11px] py-[9px] font-mono text-fine leading-[1.5] break-words whitespace-pre-wrap text-terminal-ink ${className}`}
		>
			{children}
		</code>
	);
}

/** A shell command to paste, with a copy button. */
export function CommandBlock({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="flex items-center gap-[9px] rounded-control-lg border border-line bg-terminal px-3 py-[11px]">
			<code className="min-w-0 flex-1 truncate font-mono text-mono text-terminal-ink">{command}</code>
			<button
				type="button"
				onClick={() => {
					navigator.clipboard
						.writeText(command)
						.then(() => {
							setCopied(true);
							setTimeout(() => setCopied(false), 1400);
						})
						// Refused clipboard access: the command is on screen and selectable.
						.catch(() => {});
				}}
				className={`shrink-0 rounded-control px-[9px] py-1.5 font-mono text-mono-xs leading-none font-medium tracking-[0.04em] ${
					copied ? "bg-accent text-on-accent" : "bg-control text-text2"
				}`}
			>
				{copied ? "COPIED" : "COPY"}
			</button>
		</div>
	);
}

const EDGE_LABEL ={ attention: "text-beta", error: "text-warn", destructive: "text-warn", unbuilt: "text-text3" };

/** Every state that isn't the happy path, as one card: what happened, why,
 * what we did instead, how to change it. */
export function EdgeCaseCard({
	tone = "attention",
	label,
	title,
	raw,
	why,
	detail,
	actions,
}: {
	tone?: keyof typeof EDGE_LABEL;
	label: string;
	title: string;
	raw?: string;
	why: React.ReactNode;
	detail?: React.ReactNode;
	actions: React.ReactNode;
}) {
	return (
		<div
			className={`flex flex-col gap-[10px] rounded-[10px] border bg-bg p-[18px] shadow-panel ${
				tone === "error" ? "border-warn-edge" : "border-line"
			}`}
		>
			<span className={`font-mono text-label font-medium tracking-[0.07em] uppercase ${EDGE_LABEL[tone]}`}>{label}</span>
			<span className="text-[14px] leading-[1.35] font-semibold text-text">{title}</span>
			{raw && <RawMessage>{raw}</RawMessage>}
			<p className="text-ui leading-[1.6] text-text2">{why}</p>
			{detail && <div className="rounded-control bg-chrome px-[11px] py-[9px] text-fine text-text3">{detail}</div>}
			<div className="mt-1 flex flex-wrap items-center gap-[7px]">{actions}</div>
		</div>
	);
}

/** The centred column a stage's content sits in, inside the app window. */
export function Screen({ width, children }: { width: number; children: React.ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 justify-center overflow-auto p-[34px]">
			<div style={{ width }} className="flex max-w-full flex-col gap-[18px]">
				{children}
			</div>
		</div>
	);
}

export function ScreenHeading({ title, children }: { title: string; children?: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-[7px]">
			<h1 className="text-title font-semibold tracking-[-0.01em] text-text">{title}</h1>
			{children && <p className="text-ui text-pretty text-text3">{children}</p>}
		</div>
	);
}

/** A newer Cutroom exists: says so, in one line, with the one thing to do
 * about it. Quiet on purpose -- it shouldn't compete with the screen. */
function UpdateNotice() {
	const update = useUpdateState();
	if (!update) return null;
	const { version, ready, canSelfInstall } = update;
	return (
		<span className="flex items-center gap-[9px]">
			<span className="text-fine leading-none text-text2">
				{!canSelfInstall
					? `Cutroom ${version} is out`
					: ready
						? `Cutroom ${version} installs when you quit`
						: `Downloading Cutroom ${version}`}
			</span>
			{!canSelfInstall && (
				<Button size="sm" variant="quiet" onClick={openDownloadPage}>
					Download
				</Button>
			)}
			{canSelfInstall && ready && (
				<Button size="sm" variant="quiet" onClick={restartToUpdate}>
					Restart now
				</Button>
			)}
		</span>
	);
}

/** macOS draws its own traffic lights in the desktop app (the window's title
 * bar is hidden, see electron/main.mjs), so the title bar leaves room for
 * them there and draws them only in a plain browser. */
const NATIVE_LIGHTS = hasElectronBridge() && /Mac/.test(navigator.userAgent);

/**
 * Every stage sits in the same window: the title bar with the mark, the
 * recording's name, the theme switch and whether the processing service is
 * up. The one shadow belongs to the window, which here is the whole viewport.
 */
export function AppWindow({
	fileName,
	serviceOk,
	themeMode,
	onThemeModeChange,
	onSaveProject,
	children,
}: {
	fileName?: string;
	/** Save the open episode as a `.cutroom` project. Omitted when nothing is
	 * open. Here rather than in the editor's own controls because it acts on
	 * the document, not on the edit -- the same reason the filename is here. */
	onSaveProject?: () => void;
	/** Omitted while it hasn't been asked yet (the setup gate is asking). */
	serviceOk?: boolean;
	themeMode: ThemeMode;
	onThemeModeChange: (mode: ThemeMode) => void;
	children: React.ReactNode;
}) {
	const dot = fileName ? fileName.lastIndexOf(".") : -1;
	const base = fileName && dot > 0 ? fileName.slice(0, dot) : (fileName ?? "untitled");
	const ext = fileName && dot > 0 ? fileName.slice(dot) : "";

	return (
		<div className="flex h-screen flex-col bg-panel">
			<header className="flex h-11 shrink-0 items-center gap-[14px] border-b border-line bg-chrome px-[14px] select-none [-webkit-app-region:drag]">
				{NATIVE_LIGHTS ? (
					<span className="w-[47px] shrink-0" />
				) : (
					<span className="flex gap-[7px]" aria-hidden="true">
						<span className="h-[11px] w-[11px] rounded-full bg-tl-red" />
						<span className="h-[11px] w-[11px] rounded-full bg-tl-amber" />
						<span className="h-[11px] w-[11px] rounded-full bg-tl-green" />
					</span>
				)}
				<span className="ml-1.5 flex min-w-0 items-center gap-[9px]">
					<Logo size={18} className="shrink-0 text-text" />
					<span className="truncate font-mono text-mono leading-none text-text2">
						{base}
						<span className="text-text3">{ext}</span>
					</span>
				</span>
				<span className="ml-auto flex items-center gap-[10px] [-webkit-app-region:no-drag]">
					{onSaveProject && (
						<button
							type="button"
							onClick={onSaveProject}
							title="Save this episode as a .cutroom project you can back up, move or hand on. The recording itself stays where it is."
							className="rounded-control border border-line bg-raised px-[11px] py-[5px] font-mono text-mono-xs leading-none text-text2 hover:bg-control"
						>
							Save a copy
						</button>
					)}
					<UpdateNotice />
					{/* The licences of the models Cutroom ships have to be readable
					    from inside the app, not only in the repository. */}
					<button
						type="button"
						popoverTarget="app-credits"
						title="The models and tools Cutroom is built on"
						className="font-mono text-mono-xs leading-none text-text3 hover:text-text2"
					>
						credits
					</button>
					<CreditsSheet id="app-credits" />
					<ThemeSwitcher mode={themeMode} onChange={onThemeModeChange} />
					{serviceOk !== undefined && (
						<span
							className="flex items-center gap-1.5 font-mono text-mono-xs leading-none text-text3"
							title={serviceOk ? "The processing service is running" : "The processing service isn't answering"}
						>
							<span className={`h-1.5 w-1.5 rounded-full ${serviceOk ? "bg-ok" : "bg-warn"}`} />
							{serviceOk ? "service ok" : "service down"}
						</span>
					)}
				</span>
			</header>
			<div className="flex min-h-0 flex-1 flex-col">{children}</div>
		</div>
	);
}
