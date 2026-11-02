import { getLocale } from "./i18n";

const displayNames = new Map<string, Intl.DisplayNames>();

/**
 * The name of a country from its ISO 3166-1 code ("PT" → "Portugal"), in the
 * app's language (`getLocale()` in `i18n.ts`). The browser's own data does the
 * translating, so a new language needs nothing here. Anything it does not
 * know comes back as the code.
 */
export function countryName(code: string | null | undefined): string {
	if (!code) return "—";
	const locale = getLocale();
	try {
		let names = displayNames.get(locale);
		if (!names) {
			names = new Intl.DisplayNames([locale], { type: "region" });
			displayNames.set(locale, names);
		}
		return names.of(code.toUpperCase()) ?? code;
	} catch {
		return code;
	}
}
