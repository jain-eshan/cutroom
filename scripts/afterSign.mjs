// electron-builder skips macOS code signing entirely when no paid Apple
// Developer ID certificate is available (our CI has none). An app with zero
// signature can't even launch on Apple Silicon -- macOS reports it as
// "damaged" rather than showing the usual unidentified-developer prompt.
// Ad-hoc signing gives it a signature so it launches and falls back to the
// normal right-click-to-open Gatekeeper flow.
import { execFileSync } from "node:child_process";

export default async function afterSign(context) {
	if (context.electronPlatformName !== "darwin") return;
	const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath]);
}
