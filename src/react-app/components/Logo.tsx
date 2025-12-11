import { useTheme } from "./theme-provider";
import LogoLight from "@/assets/logo-light.svg";
import LogoDark from "@/assets/logo-dark.svg";

interface LogoProps {
	className?: string;
	alt?: string;
}

/**
 * Logo component that automatically switches between light and dark versions
 * based on the current theme.
 *
 * Replace the logo files in src/react-app/assets/:
 * - logo-light.svg (for light theme - typically dark-colored logo)
 * - logo-dark.svg (for dark theme - typically light-colored logo)
 */
export function Logo({ className = "h-8 w-auto", alt = "Logo" }: LogoProps) {
	const { theme } = useTheme();

	// Determine which logo to show based on theme
	const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
	const logoSrc = isDark ? LogoDark : LogoLight;

	return <img src={logoSrc} alt={alt} className={className} />;
}





