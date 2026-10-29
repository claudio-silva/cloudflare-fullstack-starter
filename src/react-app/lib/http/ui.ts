/**
 * Which parts of the HTTP layer's default UI are shown (`installHttpLayer({ ui })`).
 *
 * Turn one off to show your own instead, built on the same state the default
 * uses (`http.state`, `connectivityStore`, `subscribeToMaintenance`,
 * `updateStore`) and the same actions (`http.retryNow`, `http.cancelHeld`,
 * `updateNow`, `postponeUpdate`). Turning one off does not change what the
 * layer does: requests are still held while offline, so an app that hides the
 * connectivity banner must say so itself — and offer Cancel — or the user is
 * left with a spinner and no explanation.
 */
export type HttpUi = {
	/** The banner shown while the server cannot be reached. */
	connectivity: boolean;
	/** The banner shown during a maintenance window. */
	maintenance: boolean;
	/** The new-version dialog, and the banner after "Postpone". */
	update: boolean;
	/** The toasts for error responses. `onError` is called either way. */
	errors: boolean;
	/**
	 * How the page is blocked while requests are held (offline, maintenance):
	 * `"banner"`, the banner over a dimmed page; `"dialog"`, a dialog in the
	 * middle of a dimmed page. See components/http/HttpLayerUi.tsx.
	 */
	blockWith: "banner" | "dialog";
};

export const DEFAULT_UI: HttpUi = { connectivity: true, maintenance: true, update: true, errors: true, blockWith: "banner" };

let ui: HttpUi = DEFAULT_UI;

export function configureUi(next: Partial<HttpUi>): void {
	ui = { ...ui, ...next };
}

export function getUi(): HttpUi {
	return ui;
}
