import { useSyncExternalStore } from "react";
import { useTheme } from "./theme-context";
import LogoLight from "@/assets/logo-light.svg";
import LogoDark from "@/assets/logo-dark.svg";
import { config } from "../../config";
import { useDemoAccounts } from "@/lib/demo";

/**
 * The starter's own mark, shown only by the starter's public demo: the files
 * in assets/demo-brand/ exist in the starter's repository alone (`npm run init`
 * deletes them), and only a deployment in demo mode uses them. A glob, so the
 * build does not break once they are gone.
 */
const demoBrand = Object.values(
	import.meta.glob<string>("../assets/demo-brand/logo.svg", { eager: true, import: "default", query: "?url" }),
)[0];

interface LogoProps {
	className?: string;
	alt?: string;
	showTitle?: boolean;
}

/**
 * Logo component that automatically switches between light and dark versions
 * based on the current theme.
 *
 * Replace the logo files in src/react-app/assets/:
 * - logo-light.svg (for light theme - typically dark-colored logo)
 * - logo-dark.svg (for dark theme - typically light-colored logo)
 */
export function Logo({ className = "h-8 w-auto", alt = "Logo", showTitle = false }: LogoProps) {
	const { theme } = useTheme();
	const systemDark = useSystemDark();

	const demo = useDemoAccounts();

	// Determine which logo to show based on theme
	const isDark = theme === "dark" || (theme === "system" && systemDark);
	const logoSrc = demoBrand && demo ? demoBrand : isDark ? LogoDark : LogoLight;
	// Where the demo's mark may replace it, nothing shows until the server has said.
	const hidden = demoBrand !== undefined && demo === undefined;

	if (showTitle) {
		return (
			<div className="flex items-center gap-3">
				<img src={logoSrc} alt={alt} className={className} style={hidden ? { visibility: "hidden" } : undefined} />
				<span className="text-xl font-semibold">{config.appName}</span>
			</div>
		);
	}

	return <img src={logoSrc} alt={alt} className={className} style={hidden ? { visibility: "hidden" } : undefined} />;
}

const darkQuery = "(prefers-color-scheme: dark)";

/** Whether the system prefers dark, followed live: a render must not read it directly. */
function useSystemDark(): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const media = window.matchMedia(darkQuery);
			media.addEventListener("change", onChange);
			return () => media.removeEventListener("change", onChange);
		},
		() => window.matchMedia(darkQuery).matches,
		() => false,
	);
}
