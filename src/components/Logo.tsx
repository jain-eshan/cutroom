/**
 * The Cutroom mark: two people at a table with two boom mics swinging in
 * from opposite corners, inside a rounded square that reads as both the
 * room and the shot. Geometry from docs/design/handoff README, "The logo
 * mark" -- 72x72 box, coordinates relative to the inner content box (inside
 * the 4px frame stroke).
 *
 * Two constraints from that spec are not decoration:
 * 1. It must stay asymmetric (differing boom angles, arm lengths, head
 *    sizes) -- an earlier symmetric version read as a face.
 * 2. Capsules must clear the heads by ~4px, or they read as hats.
 *
 * Switches construction by rendered size rather than scaling one file --
 * the reduction ladder in the same spec.
 */

const INNER = 4; // inset of the content box inside the 72x72 frame

/** A rect with only its top two corners rounded (SVG has no per-corner
 * radius on <rect>), for the shoulder/torso shapes. */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
	return `M ${x + r},${y} H ${x + w - r} A ${r},${r} 0 0 1 ${x + w},${y + r} V ${y + h} H ${x} V ${y + r} A ${r},${r} 0 0 1 ${x + r},${y} Z`;
}

function Frame({ children }: { children?: React.ReactNode }) {
	const clipId = "cutroom-frame-clip";
	return (
		<>
			<defs>
				<clipPath id={clipId}>
					<rect x={INNER} y={INNER} width={72 - 2 * INNER} height={72 - 2 * INNER} rx={13} />
				</clipPath>
			</defs>
			<rect
				x={2}
				y={2}
				width={68}
				height={68}
				rx={17}
				fill="none"
				stroke="currentColor"
				strokeWidth={4}
			/>
			<g clipPath={`url(#${clipId})`}>{children}</g>
		</>
	);
}

function FullMark() {
	return (
		<Frame>
			{/* Counter -- flush to the frame, full width */}
			<rect x={INNER} y={58} width={72 - 2 * INNER} height={10} fill="currentColor" />

			{/* Left body + head (larger, closer) */}
			<path d={topRoundedRect(13, 42, 22, 16, 11)} fill="currentColor" />
			<circle cx={24} cy={41} r={6} fill="currentColor" />

			{/* Right body + head (smaller, further) */}
			<path d={topRoundedRect(45, 46, 17, 12, 8.5)} fill="currentColor" />
			<circle cx={53.5} cy={45.5} r={4.5} fill="currentColor" />

			{/* Left boom: arm + capsule, swinging in from the top-left corner */}
			<g transform="rotate(34 5 10.5)">
				<rect x={5} y={7} width={20} height={4} rx={2} fill="currentColor" />
				<rect x={27} y={5} width={7} height={11} rx={4} fill="var(--color-accent)" />
			</g>

			{/* Right boom: arm + capsule, swinging in from the top-right corner */}
			<g transform="rotate(-22 68 26)">
				<rect x={48} y={22.5} width={13} height={3} rx={1.5} fill="currentColor" />
				<rect x={63} y={22} width={5} height={8} rx={2.5} fill="var(--color-accent)" />
			</g>
		</Frame>
	);
}

function MidMark() {
	// 26-39px: booms, bodies and counter survive; heads are dropped.
	return (
		<Frame>
			<rect x={INNER} y={58} width={72 - 2 * INNER} height={10} fill="currentColor" />
			<path d={topRoundedRect(13, 42, 22, 16, 11)} fill="currentColor" />
			<path d={topRoundedRect(45, 46, 17, 12, 8.5)} fill="currentColor" />
			<g transform="rotate(34 5 10.5)">
				<rect x={5} y={7} width={20} height={4} rx={2} fill="currentColor" />
				<rect x={27} y={5} width={7} height={11} rx={4} fill="var(--color-accent)" />
			</g>
			<g transform="rotate(-22 68 26)">
				<rect x={48} y={22.5} width={13} height={3} rx={1.5} fill="currentColor" />
				<rect x={63} y={22} width={5} height={8} rx={2.5} fill="var(--color-accent)" />
			</g>
		</Frame>
	);
}

function TinyMark() {
	// <=20px: just the two accent capsules + counter + frame. Still reads as
	// "two mics over a table" at title-bar/favicon size.
	return (
		<Frame>
			<rect x={INNER} y={58} width={72 - 2 * INNER} height={10} fill="currentColor" />
			<rect x={20} y={22} width={3} height={5.5} rx={1.5} fill="var(--color-accent)" transform="rotate(22 21.5 24.75)" />
			<rect x={50} y={24} width={2.5} height={4} rx={1.25} fill="var(--color-accent)" transform="rotate(-14 51.25 26)" />
		</Frame>
	);
}

export function Logo({ size = 40, className }: { size?: number; className?: string }) {
	const Mark = size >= 40 ? FullMark : size >= 26 ? MidMark : TinyMark;
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 72 72"
			className={className}
			role="img"
			aria-label="Cutroom"
		>
			<Mark />
		</svg>
	);
}
