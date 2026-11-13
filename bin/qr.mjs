#!/usr/bin/env node
// Prints a URL as a QR code in the terminal (bin/dev-tailnet: open the dev server on a phone by scanning).
import qrcode from "qrcode-terminal";

const url = process.argv[2];
if (!url) {
	console.error("usage: bin/qr.mjs <url>");
	process.exit(1);
}
qrcode.generate(url, { small: true }, (code) => console.log(code));
