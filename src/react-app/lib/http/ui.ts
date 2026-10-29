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
};

let ui: HttpUi = { connectivity: true, maintenance: true, update: true, errors: true };

export function configureUi(next: Partial<HttpUi>): void {
	ui = { ...ui, ...next };
}

export function getUi(): HttpUi {
	return ui;
}
