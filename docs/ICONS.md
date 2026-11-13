# App icons: `npm run icons`

One command makes every icon the app needs from a single image: the favicon, the PWA icons
(Android, iOS home screen), and the ones the App Store, Google Play and an Android build ask for. It
also points `index.html` (and the PWA manifest, when there is one) at them. Change the image, run it
again, and every icon follows.

## 1. Put the original image in `branding/icon.png`

| | |
|---|---|
| **Where** | `branding/icon.png` (create the `branding/` folder at the project root), or any path with `--source` |
| **Format** | PNG or WebP with transparency (JPEG works, but has no transparency: see below) |
| **Content** | the mark alone, **on a transparent background**: no tile, no rounded square, no shadow. The command draws the tile itself, in the shape each platform wants |
| **Size** | **1024px or more on its longer side**. Square or not, and any margin: transparent margins are trimmed, and the mark is centred |

- **Larger than 1024px:** scaled down to 1024px on its longer side, in halving steps, which keeps fine
  detail crisp.
- **Smaller than 1024px:** scaled up by interpolation, so the large icons (App Store, Google Play,
  512px) come out blurred. The command says so in a warning and makes them anyway; replace the
  image with a larger original when you have one.
- **Opaque background** (a JPEG, or a PNG with a filled background): the command warns, because
  that background shows as a box on the tile.

Commit `branding/icon.png`: it is the source of truth for every icon.

## 2. Run it

```bash
npm run icons                                   # branding/icon.png on a white tile
npm run icons -- --background "#0b1f3a"         # tile colour (hex)
npm run icons -- --source art/logo.png          # another source file
```

It renders with Playwright's Chromium, which the E2E tests already use; if it is not installed yet:
`npx playwright install chromium`. No image library is involved.

`--background` is the colour of the tile behind the mark: on the rounded PWA icon, the iOS and store
icons and Android's adaptive icon background. Pick one the mark stands out on (a mark with dark parts
needs a light tile).

## What it writes

| File | Used by |
|---|---|
| `public/favicon.ico` (16, 32, 48) and `public/icons/favicon-32.png` | browser tabs; the mark alone, transparent |
| `public/icons/icon-192.png`, `icon-512.png` | PWA manifest, `purpose: "any"`: rounded tile |
| `public/icons/maskable-192.png`, `maskable-512.png` | PWA manifest, `purpose: "maskable"`: full-bleed tile, mark inside the 80% circle every mask keeps |
| `public/icons/apple-touch-icon.png` (180) | iOS "Add to Home Screen": square and opaque (iOS rounds it) |
| `branding/store/ios/AppIcon.appiconset/` and `app-store-1024.png` | Xcode (single-size app icon set) and the App Store listing: 1024px, no alpha channel, as Apple requires |
| `branding/store/google-play/icon-512.png` | the Google Play listing icon (full square: Play rounds it) |
| `branding/store/android/res/` | a native or Trusted Web Activity Android build: launcher icons per density (legacy, round, adaptive foreground and background) |
| `website/public/favicon.ico` (the site's folder from `website.config.ts`) | the product website's favicon, when the project has one (`docs/WEBSITE.md`) |

And it updates, when they exist:

- `index.html`: the `<link rel="icon">` (now `/favicon.ico`) and `<link rel="apple-touch-icon">`
  tags. Any other icon link there is replaced, so the starter's `vite.svg` stops being used and can
  be deleted from `public/`.
- `public/manifest.webmanifest`: its `icons` list (the four PWA icons). The starter has no manifest;
  the command does not create one.

Everything under `branding/store/` is not served by the app: it is there for when the app goes to a
store. Commit it with the rest, or regenerate it then.

## Limits

- **Android's monochrome (themed) icon** is not made: Android would draw the mark as a flat
  silhouette, which loses any detail drawn inside it. For a mark that reads well as a silhouette,
  add a `<monochrome>` layer to `branding/store/android/res/mipmap-anydpi-v26/*.xml` by hand.
- **iOS launch images** (splash screens) are not made.
- **No vector output:** the icons are PNG, drawn from the PNG source.
