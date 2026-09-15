import { useEffect, useState } from "react";

/**
 * An illustrated podcast set, and the shots Cutroom cuts from it.
 *
 * Illustrated rather than filmed until a real episode clip can be shown with
 * everyone's agreement. The crops aren't decoration, though: they use the
 * same proportions as server/pipeline/framing.py (the pane is 3.5 face-heights
 * tall, the face sits 35% of the way down), so the close-ups look the way the
 * app frames them.
 */

const SCENE_W = 1600;
const SCENE_H = 900;

export type PersonId = "maya" | "dev" | "sam";

interface Person {
	name: string;
	/** Head centre and radius in scene units. */
	hx: number;
	hy: number;
	r: number;
	skin: string;
	shirt: string;
	hair: string;
}

const PEOPLE: Record<PersonId, Person> = {
	maya: { name: "Maya", hx: 430, hy: 420, r: 56, skin: "#c68d69", shirt: "#b8603a", hair: "#2a1c15" },
	dev: { name: "Dev", hx: 805, hy: 446, r: 50, skin: "#8a5a3c", shirt: "#3d6d70", hair: "#1c1816" },
	sam: { name: "Sam", hx: 1172, hy: 428, r: 53, skin: "#e2b892", shirt: "#675a8a", hair: "#7a4a2b" },
};

const FRAMING_RATIO = 3.5;
const FACE_POSITION = 0.35;

function clamp(v: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, v));
}

/** The viewBox of a medium shot on one person, for a pane of this shape. */
function cropFor(id: PersonId, aspect: number): string {
	const p = PEOPLE[id];
	const h = Math.min(SCENE_H, FRAMING_RATIO * 2 * p.r);
	const w = Math.min(SCENE_W, h * aspect);
	const x = clamp(p.hx - w / 2, 0, SCENE_W - w);
	const y = clamp(p.hy - FACE_POSITION * h, 0, SCENE_H - h);
	return `${x} ${y} ${w} ${h}`;
}

const WIDE = `0 0 ${SCENE_W} ${SCENE_H}`;

function topRounded(x: number, y: number, w: number, h: number, r: number) {
	return `M ${x + r},${y} H ${x + w - r} A ${r},${r} 0 0 1 ${x + w},${y + r} V ${y + h} H ${x} V ${y + r} A ${r},${r} 0 0 1 ${x + r},${y} Z`;
}

function Figure({ id }: { id: PersonId }) {
	const { hx, hy, r, skin, shirt, hair } = PEOPLE[id];
	const shoulder = r * 1.75;
	return (
		<g>
			{/* chair back */}
			<path d={topRounded(hx - shoulder - 22, hy + r * 0.2, (shoulder + 22) * 2, 640 - hy, 46)} fill="#2e2925" />
			{/* hair that falls behind the shoulders */}
			{id === "maya" && <path d={topRounded(hx - r * 1.2, hy - r * 1.15, r * 2.4, r * 2.9, r * 1.2)} fill={hair} />}
			{/* torso */}
			<path d={topRounded(hx - shoulder, hy + r * 1.2, shoulder * 2, 640 - hy - r * 1.2, shoulder * 0.8)} fill={shirt} />
			{/* neck */}
			<rect x={hx - r * 0.32} y={hy + r * 0.6} width={r * 0.64} height={r * 0.8} rx={r * 0.2} fill={skin} />
			<rect x={hx - r * 0.32} y={hy + r * 1.05} width={r * 0.64} height={r * 0.2} fill="#000" opacity={0.12} />
			{/* head */}
			<circle cx={hx} cy={hy} r={r} fill={skin} />
			{id === "maya" && <path d={`M ${hx - r} ${hy - r * 0.05} A ${r} ${r} 0 0 1 ${hx + r} ${hy - r * 0.05} Q ${hx + r * 0.2} ${hy - r * 0.55} ${hx - r} ${hy - r * 0.05} Z`} fill={hair} />}
			{id === "dev" && <path d={`M ${hx - r * 1.02} ${hy - r * 0.1} A ${r * 1.02} ${r * 1.02} 0 0 1 ${hx + r * 1.02} ${hy - r * 0.1} L ${hx + r * 0.9} ${hy - r * 0.35} Q ${hx} ${hy - r * 0.62} ${hx - r * 0.9} ${hy - r * 0.35} Z`} fill={hair} />}
			{id === "sam" && (
				<>
					<circle cx={hx + r * 0.1} cy={hy - r * 1.12} r={r * 0.42} fill={hair} />
					<path d={`M ${hx - r} ${hy - r * 0.1} A ${r} ${r} 0 0 1 ${hx + r} ${hy - r * 0.1} Q ${hx} ${hy - r * 0.5} ${hx - r} ${hy - r * 0.1} Z`} fill={hair} />
				</>
			)}
			{/* headphones */}
			<path
				d={`M ${hx - r * 1.08} ${hy + r * 0.1} A ${r * 1.1} ${r * 1.15} 0 0 1 ${hx + r * 1.08} ${hy + r * 0.1}`}
				fill="none"
				stroke="#1f1b18"
				strokeWidth={r * 0.16}
			/>
			<rect x={hx - r * 1.24} y={hy - r * 0.18} width={r * 0.34} height={r * 0.62} rx={r * 0.14} fill="#1f1b18" />
			<rect x={hx + r * 0.9} y={hy - r * 0.18} width={r * 0.34} height={r * 0.62} rx={r * 0.14} fill="#1f1b18" />
		</g>
	);
}

/** A boom arm swinging in from above, with the brand's accent capsule. */
function Boom({ id, side }: { id: PersonId; side: 1 | -1 }) {
	const { hx, hy, r } = PEOPLE[id];
	const cx = hx + side * r * 1.25;
	const cy = hy + r * 0.85;
	const topX = cx + side * 90;
	return (
		<g>
			<line x1={topX} y1={0} x2={cx + side * 26} y2={cy - 30} stroke="#26211d" strokeWidth={9} strokeLinecap="round" />
			<rect x={cx - 17} y={cy - 38} width={34} height={64} rx={17} fill="#f0883e" transform={`rotate(${side * -24} ${cx} ${cy})`} />
			<rect x={cx - 17} y={cy + 8} width={34} height={10} fill="#000" opacity={0.18} transform={`rotate(${side * -24} ${cx} ${cy})`} />
		</g>
	);
}

/** The set itself, drawn once in scene units and viewed through any viewBox. */
function SceneArt() {
	return (
		<>
			<rect width={SCENE_W} height={SCENE_H} fill="#e7dfd3" />
			{/* acoustic panels */}
			{[130, 520, 910].map((x, i) => (
				<rect key={x} x={x} y={110} width={360} height={470} rx={18} fill={i === 1 ? "#d6cabb" : "#ddd2c4"} />
			))}
			{/* the show's sign */}
			<g transform="translate(1410 110)">
				<rect width={170} height={112} rx={16} fill="#2e2925" />
				<rect x={20} y={80} width={130} height={12} rx={3} fill="#e7dfd3" />
				<rect x={42} y={34} width={12} height={24} rx={6} fill="#f0883e" transform="rotate(24 48 46)" />
				<rect x={114} y={38} width={10} height={18} rx={5} fill="#f0883e" transform="rotate(-16 119 47)" />
			</g>
			{/* shelf */}
			<rect x={1390} y={330} width={200} height={12} rx={4} fill="#8a6a50" />
			{["#b8603a", "#3d6d70", "#d9b36a", "#675a8a", "#4a3a2f"].map((c, i) => (
				<rect key={c} x={1402 + i * 28} y={250 + (i % 2) * 14} width={22} height={80 - (i % 2) * 14} rx={3} fill={c} />
			))}
			<rect x={1548} y={290} width={30} height={40} rx={6} fill="#c9b8a4" />
			{/* plant */}
			<g transform="translate(70 360)">
				{[-38, -12, 14, 40, -60, 62].map((a, i) => (
					<ellipse key={a} cx={60} cy={120} rx={22} ry={90} fill={i % 2 ? "#5f8060" : "#6f9270"} transform={`rotate(${a} 60 210)`} />
				))}
				<path d="M 18 200 H 102 L 92 290 H 28 Z" fill="#b8603a" />
			</g>
			{/* people, then the table in front of them */}
			<Figure id="maya" />
			<Figure id="dev" />
			<Figure id="sam" />
			<Boom id="maya" side={-1} />
			<Boom id="dev" side={1} />
			<Boom id="sam" side={1} />
			<rect x={0} y={630} width={SCENE_W} height={30} fill="#6b5140" />
			<rect x={0} y={660} width={SCENE_W} height={240} fill="#4e3b2e" />
			{/* mugs and a laptop */}
			<rect x={560} y={588} width={42} height={46} rx={8} fill="#f3eee6" />
			<rect x={1330} y={594} width={40} height={40} rx={8} fill="#3d6d70" />
			<path d="M 930 628 L 950 560 H 1090 L 1110 628 Z" fill="#b9b3ab" />
		</>
	);
}

function Shot({ viewBox, className, label }: { viewBox: string; className?: string; label: string }) {
	return (
		<svg viewBox={viewBox} preserveAspectRatio="xMidYMid slice" className={className} role="img" aria-label={label}>
			<SceneArt />
		</svg>
	);
}

/** A medium shot on one person, for a pane of the given width/height ratio. */
export function CloseUp({ id, aspect, className }: { id: PersonId; aspect: number; className?: string }) {
	return <Shot viewBox={cropFor(id, aspect)} className={className} label={`Close on ${PEOPLE[id].name}`} />;
}

export function WideShot({ className }: { className?: string }) {
	return <Shot viewBox={WIDE} className={className} label="Wide shot of all three people" />;
}

type Kind = "close" | "both" | "wide";

interface ShotSpec {
	start: number;
	end: number;
	kind: Kind;
	who: PersonId[];
	caption: string;
}

const LOOP_S = 18;

const SHOTS: ShotSpec[] = [
	{ start: 0, end: 3.2, kind: "close", who: ["maya"], caption: "The whole first season, we recorded in a closet." },
	{ start: 3.2, end: 5.8, kind: "close", who: ["dev"], caption: "Wait. You recorded season one where?" },
	{ start: 5.8, end: 8.4, kind: "both", who: ["maya", "dev"], caption: "In a closet! / A closet?" },
	{ start: 8.4, end: 11.8, kind: "close", who: ["sam"], caption: "Honestly? Best acoustics we ever had." },
	{ start: 11.8, end: 14.2, kind: "wide", who: [], caption: "(everyone laughs)" },
	{ start: 14.2, end: 18, kind: "close", who: ["maya"], caption: "You just couldn't breathe in there." },
];

// Who is actually talking, drawn under the shots the way the editor's speaker
// lanes are. Dev's overlap starts before Maya's close-up ends on purpose.
const SPEECH: Record<PersonId, [number, number][]> = {
	maya: [
		[0.2, 3.1],
		[5.9, 8.2],
		[14.3, 17.7],
	],
	dev: [
		[3.3, 5.7],
		[6.3, 8.3],
	],
	sam: [[8.5, 11.6]],
};

const KIND_FILL: Record<Kind, string> = { close: "bg-r-close", both: "bg-r-both", wide: "bg-r-wide" };
const LANE_FILL: Record<PersonId, string> = { maya: "bg-s1", dev: "bg-s2", sam: "bg-s3" };

function shotLabel(shot: ShotSpec): string {
	if (shot.kind === "wide") return "Wide";
	if (shot.kind === "both") return shot.who.map((id) => PEOPLE[id].name).join(" + ");
	return `Close on ${PEOPLE[shot.who[0]].name}`;
}

function formatTime(t: number) {
	return `0:${String(Math.floor(t)).padStart(2, "0")}`;
}

/** The hero: the edit playing, with the timeline that made it underneath. */
export function FramingDemo() {
	const [t, setT] = useState(0);
	const [playing, setPlaying] = useState(
		() => typeof window === "undefined" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);

	useEffect(() => {
		if (!playing) return;
		let last = performance.now();
		const id = setInterval(() => {
			const now = performance.now();
			setT((v) => (v + (now - last) / 1000) % LOOP_S);
			last = now;
		}, 80);
		return () => clearInterval(id);
	}, [playing]);

	const shot = SHOTS.find((s) => t >= s.start && t < s.end) ?? SHOTS[0];
	const pct = (v: number) => `${(v / LOOP_S) * 100}%`;

	return (
		<div>
			<div className="rounded-[14px] border border-line bg-raised p-2.5 shadow-[0_24px_60px_-24px_rgba(40,30,20,0.35)]">
				<div className="relative aspect-video overflow-hidden rounded-[8px] bg-black">
					{shot.kind === "wide" && <WideShot className="h-full w-full" />}
					{shot.kind === "close" && <CloseUp id={shot.who[0]} aspect={16 / 9} className="h-full w-full" />}
					{shot.kind === "both" && (
						<div className="flex h-full">
							{shot.who.map((id) => (
								<div key={id} className="relative h-full flex-1 border-l-2 border-black first:border-l-0">
									<CloseUp id={id} aspect={8 / 9} className="h-full w-full" />
								</div>
							))}
						</div>
					)}

					<span className="absolute top-3 left-3 rounded-chip bg-black/55 px-2 py-1 text-[12px] text-white">
						{shotLabel(shot)}
					</span>
					{/* Hidden on phones, where it would sit on top of the caption. */}
					<span className="absolute right-3 bottom-3 hidden rounded-chip bg-black/55 px-2 py-1 font-mono text-[11px] text-white sm:inline">
						{formatTime(t)}
					</span>
					<p className="absolute inset-x-0 bottom-[9%] mx-auto w-fit max-w-[80%] rounded-[6px] bg-black/70 px-3 py-1.5 text-center text-[clamp(11px,1.7vw,17px)] leading-snug text-white">
						{shot.caption}
					</p>
				</div>

				{/* The timeline that produced the cut above. */}
				<div className="px-1 pt-3 pb-1">
					<div className="relative">
						<div className="relative h-8 overflow-hidden rounded-[5px] border border-line bg-track">
							{SHOTS.map((s) => (
								<button
									type="button"
									key={s.start}
									onClick={() => setT(s.start)}
									aria-label={`Jump to ${shotLabel(s)}`}
									className={`absolute inset-y-0 flex items-center overflow-hidden border-r border-raised px-2 text-left ${KIND_FILL[s.kind]} ${
										s === shot ? "ring-2 ring-handle ring-inset" : ""
									}`}
									style={{ left: pct(s.start), width: pct(s.end - s.start) }}
								>
									{/* Too narrow to read on a phone; the colours still show the cuts. */}
									<span className="hidden truncate text-[10px] font-medium whitespace-nowrap text-r-ink sm:inline">
										{shotLabel(s)}
									</span>
								</button>
							))}
						</div>
						<div className="mt-1.5 flex flex-col gap-1">
							{(Object.keys(SPEECH) as PersonId[]).map((id) => (
								<div key={id} className="flex items-center gap-2">
									<span className="w-9 text-[10px] text-text3">{PEOPLE[id].name}</span>
									<div className="relative h-[7px] flex-1 overflow-hidden rounded-full bg-track">
										{SPEECH[id].map(([a, b]) => (
											<div key={a} className={`absolute inset-y-0 ${LANE_FILL[id]}`} style={{ left: pct(a), width: pct(b - a) }} />
										))}
									</div>
								</div>
							))}
						</div>
						<div
							className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-handle"
							style={{ left: `calc(${pct(t)})` }}
							aria-hidden
						/>
					</div>
				</div>
			</div>

			<div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[13px] text-text3">
				<button
					type="button"
					onClick={() => setPlaying((p) => !p)}
					className="rounded-control border border-line bg-panel px-2.5 py-1 text-[12px] text-text2 hover:bg-chrome"
				>
					{playing ? "Pause" : "Play"}
				</button>
				<span>An illustration of how Cutroom frames a one-camera recording. Click a shot to jump to it.</span>
			</div>
		</div>
	);
}
