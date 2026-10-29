import { useEffect, useState, useSyncExternalStore } from "react";
import { connectivityStore, type ConnectivityState } from "@/lib/http/connectivity";
import { getMaintenanceState, subscribeToMaintenance, type MaintenanceState } from "@/lib/http/maintenance";
import { getUi } from "@/lib/http/ui";
import { updateStore, type UpdateState } from "@/lib/http/version";

/**
 * The HTTP layer's state, for React: what the default banners and dialog
 * render, and what an app that turns them off (`installHttpLayer({ ui })`)
 * builds its own from.
 */

export function useConnectivity(): ConnectivityState {
	return useSyncExternalStore(connectivityStore.subscribe, connectivityStore.get);
}

export function useMaintenance(): MaintenanceState {
	// Not useSyncExternalStore: getMaintenanceState returns a new object every call.
	const [state, setState] = useState(getMaintenanceState);
	useEffect(() => subscribeToMaintenance(setState), []);
	return state;
}

export function useUpdateState(): UpdateState {
	return useSyncExternalStore(updateStore.subscribe, updateStore.get);
}

/** Why the page is blocked, or `null`. See HttpLayerUi.tsx. */
export type Blocked = "maintenance" | "connectivity" | null;

/**
 * Requests are held, so the user must wait: a maintenance window with
 * requests waiting on it, or a lost connection with requests that no offline
 * handler answered. Only for the parts of the default UI that are on; an app
 * that turns one off decides itself whether to block.
 */
export function useBlocked(): Blocked {
	const maintenance = useMaintenance();
	const { state, held } = useConnectivity();
	const ui = getUi();
	if (ui.maintenance && maintenance.active && maintenance.waiting > 0) return "maintenance";
	if (ui.connectivity && !maintenance.active && (state === "offline" || state === "reconnecting") && held > 0) return "connectivity";
	return null;
}
