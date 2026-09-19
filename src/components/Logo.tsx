import { useId } from "react";

/**
 * The Cutroom mark: two people at a table with two boom mics swinging in
 * from opposite corners, inside a rounded square that reads as both the
 * room and the shot. Geometry is the design system's `assets/logo/*.svg`
 * (via `components/core/Logo.jsx`), copied rather than redrawn.
 *
 * Switches construction by rendered size, never by scaling one version down:
 * 20px and under is the tiny mark (capsules and counter only); above that,
 * the full mark. Each is drawn in its own viewBox, 16 and 72.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
	const clipId = useId();

	if (size <= 20) {
		return (
			<svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} role="img" aria-label="Cutroom">
				<defs>
					<clipPath id={clipId}>
						<rect x="1.5" y="1.5" width="13" height="13" rx="2.5" />
					</clipPath>
				</defs>
				<g clipPath={`url(#${clipId})`}>
					<rect x="3.5" y="3" width="3" height="5.5" rx="1.5" fill="var(--color-accent)" transform="rotate(22 5 5.75)" />
					<rect x="10" y="6" width="2.5" height="4" rx="1.25" fill="var(--color-accent)" transform="rotate(-14 11.25 8)" />
					<rect x="1.5" y="11" width="13" height="3.5" fill="currentColor" />
				</g>
				<rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.25" stroke="currentColor" strokeWidth="1.5" />
			</svg>
		);
	}

	return (
		<svg width={size} height={size} viewBox="0 0 72 72" fill="none" className={className} role="img" aria-label="Cutroom">
			<defs>
				<clipPath id={clipId}>
					<rect x="4" y="4" width="64" height="64" rx="13" />
				</clipPath>
			</defs>
			<g clipPath={`url(#${clipId})`}>
				<g transform="rotate(34 5 10.5)">
					<rect x="5" y="8.5" width="20" height="4" rx="2" fill="currentColor" />
					<rect x="27" y="5" width="7" height="11" rx="3.5" fill="var(--color-accent)" />
				</g>
				<g transform="rotate(-22 68 26)">
					<rect x="48" y="22" width="5" height="8" rx="2.5" fill="var(--color-accent)" />
					<rect x="55" y="24.5" width="13" height="3" rx="1.5" fill="currentColor" />
				</g>
				<circle cx="24" cy="41" r="6" fill="currentColor" />
				<path d="M13 58V53a11 11 0 0 1 22 0v5Z" fill="currentColor" />
				<circle cx="53.5" cy="45.5" r="4.5" fill="currentColor" />
				<path d="M45 58v-3.5a8.5 8.5 0 0 1 17 0V58Z" fill="currentColor" />
				<rect x="4" y="58" width="64" height="10" fill="currentColor" />
			</g>
			<rect x="2" y="2" width="68" height="68" rx="15" stroke="currentColor" strokeWidth="4" />
		</svg>
	);
}
