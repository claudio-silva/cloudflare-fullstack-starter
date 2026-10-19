/** Minimal plain-text fallback derived from an HTML body (keeps link targets). */
export function htmlToText(html: string): string {
	return html
		.replace(/<(style|head|title)[\s\S]*?<\/\1>/gi, "")
		.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
		.replace(/<\/(p|div|h[1-6]|tr)>|<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n+/g, "\n\n")
		.trim();
}
