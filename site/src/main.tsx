import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "./site.css";
import { Landing } from "./Landing";
import { initAnalytics } from "./analytics";

initAnalytics();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Landing />
		{/* Cookieless, and inert outside production. */}
		<Analytics />
	</StrictMode>,
);
