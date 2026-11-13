# Testing on a phone

A phone on the same Wi-Fi can open `http://<your-machine>:5173`, but plain HTTP on a LAN address is not
a secure context: the microphone, camera, clipboard, service worker and PWA install do not work there.
`npm run dev:tailnet` serves the dev server over HTTPS to your own devices through
[Tailscale](https://tailscale.com), and prints the address as a QR code to scan.

## Setup (once)

1. Install Tailscale on the dev machine and on the phone, signed in to the same tailnet.
2. Tailscale admin console, **DNS**: enable **MagicDNS** and **HTTPS Certificates**.
3. macOS: if `tailscale serve` asks for permission, run `sudo tailscale set --operator=$USER`.

## Every time

```bash
npm run dev:tailnet
```

It starts Vite on `127.0.0.1` (plain HTTP, reachable from this machine only) and puts
`tailscale serve` in front of it, so `https://<machine>.<tailnet>.ts.net` has a trusted Let's Encrypt
certificate: no warning, a secure context, and a PWA can be installed. Only devices on your tailnet can
reach it (`tailscale serve`, not `funnel`). The `tailscale serve` configuration stays after the dev
server stops; remove it with `tailscale serve --https=443 off`.

`tailscale serve` must point at `127.0.0.1`: on macOS it cannot reach the machine's own Tailscale
address, and the page hangs.

## Without HTTPS certificates: self-signed

```bash
npm run dev:tailnet -- --self-signed
```

(also what it falls back to when `tailscale serve` fails). Vite listens **only on the Tailscale
interface**, with a self-signed certificate for the machine's Tailscale IP and MagicDNS name
(`.wrangler/dev-cert/`). The browser warns once ("Advanced", then "Proceed"); the page is then a secure
context, but the address bar shows "Not secure" and a PWA cannot be installed.

## Notes

- Vite accepts `*.ts.net` host names (`server.allowedHosts` in `vite.config.ts`); IP addresses are
  always accepted.
- Sign-in works: in `local`, auth trusts any origin (`docs/MECHANISMS.md`, "Which hosts may sign in").
- Hot reload works through `tailscale serve` (it proxies the WebSocket).
- Another port: `PORT=5174 npm run dev:tailnet`.
