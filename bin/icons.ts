/**
 * npm run icons: every app icon (PWA, favicon, App Store, Google Play, Android launcher) from one
 * image, rendered with Playwright's Chromium (no image library). Guide: docs/ICONS.md.
 *
 *   npm run icons                                  # branding/icon.png, white tile
 *   npm run icons -- --source art/logo.png --background "#0b1f3a"
 *
 * The source is the mark on a transparent background, ideally 1024px or more on its longer side
 * (the store icons are 1024px). Its transparent margins are trimmed, then it is brought to 1024px
 * on the longer side: scaled down when larger, scaled up by interpolation when smaller (blurred, so
 * a warning says so; the icons are made anyway).
 *
 * PWA (public/):
 *   favicon.ico (16, 32, 48), icons/favicon-32.png        the mark alone, transparent
 *   icons/icon-192.png, icons/icon-512.png                 "any": rounded tile
 *   icons/maskable-192.png, icons/maskable-512.png         "maskable": full-bleed, mark in the safe zone
 *   icons/apple-touch-icon.png (180)                       iOS home screen: square, opaque (iOS rounds it)
 * Stores (branding/store/, not served):
 *   ios/AppIcon.appiconset/ (1024, opaque, Xcode single-size set) and app-store-1024.png
 *   google-play/icon-512.png (the Play listing icon, full square: Play rounds it)
 *   android/res/ (launcher icons per density: legacy, round and adaptive layers), for a native or
 *   Trusted Web Activity build
 * Wiring: index.html gets the favicon and apple-touch-icon links; public/manifest.webmanifest, when
 * the project has one, gets the icon list; the product website's public/favicon.ico, when
 * the project has one (website.config.ts).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { deflateSync, inflateSync } from "node:zlib";
import { chromium, type Browser } from "@playwright/test";
import { loadWebsiteConfig } from "./lib/website-config";

const root = process.cwd();
const SIZE = 1024;

const { values: args } = parseArgs({
	options: {
		source: { type: "string", default: "branding/icon.png" },
		background: { type: "string", default: "#ffffff" },
		help: { type: "boolean", short: "h", default: false },
	},
});

if (args.help) {
	console.log(`npm run icons [-- --source <image>] [--background <css colour>]

  --source       the original image (default branding/icon.png): the mark on a transparent
                 background, 1024px or more on its longer side
  --background   colour of the tile behind the mark (default #ffffff)

Guide: docs/ICONS.md`);
	process.exit(0);
}

const SOURCE = resolve(root, args.source!);
const BACKGROUND = args.background!;
// Hex only: the same value goes into Android's colour resource, which takes nothing else.
if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(BACKGROUND)) {
	console.error(`--background must be a hex colour such as #ffffff (got ${BACKGROUND})`);
	process.exit(1);
}

type Shape = "none" | "square" | "rounded" | "circle";

interface Target {
	path: string;
	size: number;
	/** Size of the mark's longer side, as a fraction of the icon. */
	mark: number;
	shape: Shape;
	/** No alpha channel at all (App Store). */
	opaque?: boolean;
}

/** Adaptive icon layers are 108dp, of which only the centre 66dp is sure to show. */
const ADAPTIVE_MARK = 0.5;
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 } as const;

const targets: Target[] = [
	{ path: "public/icons/favicon-32.png", size: 32, mark: 1, shape: "none" },
	{ path: "public/icons/icon-192.png", size: 192, mark: 0.76, shape: "rounded" },
	{ path: "public/icons/icon-512.png", size: 512, mark: 0.76, shape: "rounded" },
	// Maskable: whatever the mask, a circle of 80% of the icon shows; the mark's corners stay inside it.
	{ path: "public/icons/maskable-192.png", size: 192, mark: 0.58, shape: "square" },
	{ path: "public/icons/maskable-512.png", size: 512, mark: 0.58, shape: "square" },
	{ path: "public/icons/apple-touch-icon.png", size: 180, mark: 0.72, shape: "square", opaque: true },
	{ path: "branding/store/ios/AppIcon.appiconset/AppIcon-1024.png", size: 1024, mark: 0.72, shape: "square", opaque: true },
	{ path: "branding/store/ios/app-store-1024.png", size: 1024, mark: 0.72, shape: "square", opaque: true },
	{ path: "branding/store/google-play/icon-512.png", size: 512, mark: 0.7, shape: "square", opaque: true },
	...Object.entries(densities).flatMap(([name, k]): Target[] => [
		{ path: `branding/store/android/res/mipmap-${name}/ic_launcher.png`, size: 48 * k, mark: 0.74, shape: "rounded" },
		{ path: `branding/store/android/res/mipmap-${name}/ic_launcher_round.png`, size: 48 * k, mark: 0.6, shape: "circle" },
		{ path: `branding/store/android/res/mipmap-${name}/ic_launcher_foreground.png`, size: 108 * k, mark: ADAPTIVE_MARK, shape: "none" },
	]),
];

const ICO_SIZES = [16, 32, 48];

const MIME: Record<string, string> = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

async function render(browser: Browser, dataUrl: string, t: { size: number; mark: number; shape: Shape; opaque?: boolean }): Promise<Buffer> {
	const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
	const radius = t.shape === "rounded" ? "22.5%" : t.shape === "circle" ? "50%" : "0";
	const bg = t.shape === "none" ? "transparent" : BACKGROUND;
	await page.setContent(`<!doctype html><html><head><style>
		html,body{margin:0;background:${t.opaque ? BACKGROUND : "transparent"}}
		#tile{width:${t.size}px;height:${t.size}px;display:flex;align-items:center;justify-content:center;background:${bg};border-radius:${radius};overflow:hidden}
		img{max-width:${t.mark * 100}%;max-height:${t.mark * 100}%;object-fit:contain}
	</style></head><body><div id="tile"><img src="${dataUrl}"></div></body></html>`);
	await page.waitForFunction("document.querySelector('img')?.complete");
	const png = await page.screenshot({ type: "png", omitBackground: !t.opaque, clip: { x: 0, y: 0, width: t.size, height: t.size } });
	await page.close();
	return t.opaque ? stripAlpha(png) : png;
}

interface Prepared {
	url: string;
	width: number;
	height: number;
	trimmed: number[];
	opaqueCorners: boolean;
}

/**
 * The source without its transparent margins (alpha below 8 counts as transparent), brought to
 * SIZE px on its longer side. Downscaling halves in steps, which keeps fine detail crisp.
 */
async function prepare(browser: Browser, dataUrl: string): Promise<Prepared> {
	const page = await browser.newPage();
	const result = await page.evaluate(`(async () => {
		const img = new Image();
		img.src = ${JSON.stringify(dataUrl)};
		await img.decode();
		let c = document.createElement("canvas");
		c.width = img.naturalWidth;
		c.height = img.naturalHeight;
		const ctx = c.getContext("2d");
		ctx.drawImage(img, 0, 0);
		const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
		const alpha = (x, y) => data[(y * width + x) * 4 + 3];
		const opaqueCorners = [alpha(0, 0), alpha(width - 1, 0), alpha(0, height - 1), alpha(width - 1, height - 1)].every((a) => a > 245);
		let x0 = width, y0 = height, x1 = -1, y1 = -1;
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++)
				if (alpha(x, y) >= 8) {
					if (x < x0) x0 = x;
					if (x > x1) x1 = x;
					if (y < y0) y0 = y;
					if (y > y1) y1 = y;
				}
		if (x1 < 0) throw new Error("the source image is fully transparent");
		let w = x1 - x0 + 1, h = y1 - y0 + 1;
		let cur = document.createElement("canvas");
		cur.width = w;
		cur.height = h;
		cur.getContext("2d").drawImage(c, x0, y0, w, h, 0, 0, w, h);
		const trimmed = [w, h];
		const k = ${SIZE} / Math.max(w, h);
		const tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
		const step = (nw, nh) => {
			const n = document.createElement("canvas");
			n.width = nw;
			n.height = nh;
			const nctx = n.getContext("2d");
			nctx.imageSmoothingEnabled = true;
			nctx.imageSmoothingQuality = "high";
			nctx.drawImage(cur, 0, 0, nw, nh);
			cur = n;
		};
		while (cur.width / 2 >= tw && cur.height / 2 >= th) step(Math.round(cur.width / 2), Math.round(cur.height / 2));
		if (cur.width !== tw || cur.height !== th) step(tw, th);
		return { url: cur.toDataURL("image/png"), width: tw, height: th, trimmed, opaqueCorners };
	})()`);
	await page.close();
	return result as Prepared;
}

/** Decodes an 8-bit RGBA PNG (as Chromium writes them) into its pixels. */
function decodeRgba(png: Buffer): { width: number; height: number; rgba: Buffer } {
	const width = png.readUInt32BE(16);
	const height = png.readUInt32BE(20);
	const colorType = png[25];
	if (colorType !== 6 || png[24] !== 8) throw new Error(`unexpected PNG format (type ${colorType}, depth ${png[24]})`);
	const idat: Buffer[] = [];
	for (let i = 8; i < png.length; ) {
		const len = png.readUInt32BE(i);
		if (png.toString("ascii", i + 4, i + 8) === "IDAT") idat.push(png.subarray(i + 8, i + 8 + len));
		i += 12 + len;
	}
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * 4;
	const rgba = Buffer.alloc(height * stride);
	// Undo the PNG filters, one scanline at a time.
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let x = 0; x < stride; x++) {
			const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
			const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
			const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
			let v = line[x];
			if (filter === 1) v += a;
			else if (filter === 2) v += b;
			else if (filter === 3) v += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			rgba[y * stride + x] = v & 0xff;
		}
	}
	return { width, height, rgba };
}

/** Re-encodes an opaque RGBA PNG as RGB (the App Store rejects icons with an alpha channel). */
function stripAlpha(png: Buffer): Buffer {
	if (png[25] === 2) return png;
	const { width, height, rgba } = decodeRgba(png);
	const rgb = Buffer.alloc(height * (width * 3 + 1));
	for (let y = 0; y < height; y++) {
		const o = y * (width * 3 + 1);
		for (let x = 0; x < width; x++) rgba.copy(rgb, o + 1 + x * 3, (y * width + x) * 4, (y * width + x) * 4 + 3);
	}
	const chunk = (type: string, data: Buffer) => {
		const out = Buffer.alloc(12 + data.length);
		out.writeUInt32BE(data.length, 0);
		out.write(type, 4, "ascii");
		data.copy(out, 8);
		out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
		return out;
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	return Buffer.concat([png.subarray(0, 8), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rgb, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(buf: Buffer): number {
	let c = ~0;
	for (const byte of buf) {
		c ^= byte;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	}
	return ~c >>> 0;
}

/** An .ico holding PNG images (supported by every current browser). */
function ico(pngs: { size: number; png: Buffer }[]): Buffer {
	const header = Buffer.alloc(6 + 16 * pngs.length);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(pngs.length, 4);
	let offset = header.length;
	pngs.forEach(({ size, png }, i) => {
		const e = 6 + 16 * i;
		header[e] = size >= 256 ? 0 : size;
		header[e + 1] = size >= 256 ? 0 : size;
		header.writeUInt16LE(1, e + 4);
		header.writeUInt16LE(32, e + 6);
		header.writeUInt32LE(png.length, e + 8);
		header.writeUInt32LE(offset, e + 12);
		offset += png.length;
	});
	return Buffer.concat([header, ...pngs.map((p) => p.png)]);
}

async function write(path: string, data: Buffer | string): Promise<void> {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), data);
	console.log(`wrote ${path}`);
}

/** index.html: the favicon and the iOS home screen icon (idempotent). */
async function wireIndexHtml(): Promise<void> {
	const file = join(root, "index.html");
	if (!existsSync(file)) return;
	const before = await readFile(file, "utf-8");
	// Already wired (links of its own, wherever they sit, are left alone).
	if (/<link rel="icon"[^>]*href="\/favicon\.ico"/.test(before) && /<link rel="apple-touch-icon"[^>]*href="\/icons\/apple-touch-icon\.png"/.test(before)) return;
	let html = before.replace(/^[ \t]*<link rel="icon"[^>]*>\r?\n/gm, "").replace(/^[ \t]*<link rel="apple-touch-icon"[^>]*>\r?\n/gm, "");
	const indent = /^([ \t]*)<meta charset/m.exec(html)?.[1] ?? "    ";
	const links = `${indent}<link rel="icon" href="/favicon.ico" sizes="48x48" />\n${indent}<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />\n`;
	html = html.replace(/(<meta charset[^>]*>\r?\n)/, `$1${links}`);
	if (html !== before) await write("index.html", html);
}

/** public/manifest.webmanifest, when the project has one: its icon list. */
async function wireManifest(): Promise<void> {
	const file = join(root, "public", "manifest.webmanifest");
	if (!existsSync(file)) return;
	const manifest = JSON.parse(await readFile(file, "utf-8")) as Record<string, unknown>;
	const icons = [
		{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
		{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
		{ src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
		{ src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
	];
	// Already listed: the file keeps its own formatting.
	if (JSON.stringify(manifest.icons) === JSON.stringify(icons)) return;
	manifest.icons = icons;
	await write("public/manifest.webmanifest", JSON.stringify(manifest, null, 2) + "\n");
}

async function main(): Promise<void> {
	if (!existsSync(SOURCE)) {
		console.error(`No source image at ${relative(root, SOURCE)}.
Put the original icon there (the mark on a transparent background, PNG or WebP, 1024px or more on
its longer side), or pass another file with --source. Guide: docs/ICONS.md`);
		process.exit(1);
	}
	const mime = MIME[extname(SOURCE).toLowerCase()];
	if (!mime) throw new Error(`unsupported source format ${extname(SOURCE)} (use PNG, WebP or JPEG)`);
	const source = `data:${mime};base64,${(await readFile(SOURCE)).toString("base64")}`;

	let browser: Browser;
	try {
		browser = await chromium.launch();
	} catch (error) {
		console.error("Playwright's Chromium is not installed: run `npx playwright install chromium`, then try again.");
		throw error;
	}
	try {
		const prepared = await prepare(browser, source);
		const [w, h] = prepared.trimmed;
		const longer = Math.max(w, h);
		console.log(`source ${relative(root, SOURCE)}: ${w}x${h} after trimming its transparent margins, ${longer > SIZE ? "scaled down" : longer < SIZE ? "scaled up" : "kept"} to ${prepared.width}x${prepared.height}`);
		if (longer < SIZE)
			console.warn(`warning: the source is ${longer}px on its longer side, less than ${SIZE}px; it was enlarged by interpolation, so the larger icons (App Store, Google Play, 512px) will look blurred. Provide an original of ${SIZE}px or more for sharp icons.`);
		if (prepared.opaqueCorners)
			console.warn("warning: the source has an opaque background; the icons show it as a box on the tile. A transparent background is expected (docs/ICONS.md).");
		for (const t of targets) await write(t.path, await render(browser, prepared.url, t));
		const icoPngs = [];
		for (const size of ICO_SIZES) icoPngs.push({ size, png: await render(browser, prepared.url, { size, mark: 1, shape: "none" }) });
		const favicon = ico(icoPngs);
		await write("public/favicon.ico", favicon);
		const website = loadWebsiteConfig(root);
		if (website && existsSync(join(root, website.dir, "public"))) await write(join(website.dir, "public", "favicon.ico"), favicon);
	} finally {
		await browser.close();
	}

	await write(
		"branding/store/ios/AppIcon.appiconset/Contents.json",
		JSON.stringify({ images: [{ filename: "AppIcon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" }], info: { author: "xcode", version: 1 } }, null, 2) + "\n",
	);
	// No <monochrome> layer: Android would draw the mark as a flat silhouette, which loses any detail
	// drawn inside it. Add one by hand for a mark that reads well as a silhouette.
	const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`;
	await write("branding/store/android/res/mipmap-anydpi-v26/ic_launcher.xml", adaptive);
	await write("branding/store/android/res/mipmap-anydpi-v26/ic_launcher_round.xml", adaptive);
	await write(
		"branding/store/android/res/values/ic_launcher_background.xml",
		`<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BACKGROUND.toUpperCase()}</color>\n</resources>\n`,
	);
	await wireIndexHtml();
	await wireManifest();
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
