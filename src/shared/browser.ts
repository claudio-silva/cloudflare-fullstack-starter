/**
 * "Chrome · Desktop" from a User-Agent string: the browser's name and whether
 * it is a phone, a tablet or a computer. Good enough to recognise a sign-in,
 * not a fingerprint: an iPad in desktop mode says it is a Mac, and anything the
 * list below does not know falls back to the raw string. Order matters, as most
 * browsers also claim to be Chrome and Safari.
 */
export function describeBrowser(userAgent: string | null): string {
	if (!userAgent) return "—";
	const ua = userAgent;
	const names: [RegExp, string][] = [
		[/Edg(e|A|iOS)?\//, "Edge"],
		[/OPR\/|Opera/, "Opera"],
		[/SamsungBrowser/, "Samsung Internet"],
		[/Firefox\/|FxiOS/, "Firefox"],
		[/Chrome\/|CriOS/, "Chrome"],
		[/Safari\//, "Safari"],
	];
	const name = names.find(([pattern]) => pattern.test(ua))?.[1];
	if (!name) return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua; // curl, bots, apps
	const device = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? "Tablet" : /Mobi|iPhone|iPod|Android/i.test(ua) ? "Mobile" : "Desktop";
	return `${name} · ${device}`;
}
