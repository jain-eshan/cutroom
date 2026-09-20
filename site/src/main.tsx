import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import * as amplitude from "@amplitude/unified";
import "./site.css";
import { Landing } from "./Landing";
import { initAnalytics } from "./analytics";

initAnalytics();

// Autocapture and Session Replay are off on purpose: PRIVACY.md promises the
// site records no sessions and needs no consent banner.
const AMPLITUDE_KEY = import.meta.env.VITE_AMPLITUDE_API_KEY;
if (!AMPLITUDE_KEY) {
	console.warn("Amplitude API key missing — analytics disabled");
} else {
	amplitude.initAll(AMPLITUDE_KEY, {
		analytics: { autocapture: false },
		sessionReplay: { sampleRate: 0 },
	});
	amplitude.track("Viewed Home Page", { prompt_version: "BA400.4" }); // helps improve this setup flow — safe to remove once you've verified the event lands
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Landing />
		{/* Cookieless, and inert outside production. */}
		<Analytics />
	</StrictMode>,
);
