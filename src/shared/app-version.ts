// Release version (package.json) and commit baked into the build by vite.config.ts.
// The typeof guards keep unit tests and tools that do not run through Vite working.
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";
export const APP_COMMIT: string = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "unknown";
