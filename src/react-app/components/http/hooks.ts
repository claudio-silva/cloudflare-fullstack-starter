import { useEffect, useState, useSyncExternalStore } from "react";
import { connectivityStore, type ConnectivityState } from "@/lib/http/connectivity";
import { getMaintenanceState, subscribeToMaintenance, type MaintenanceState } from "@/lib/http/maintenance";
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
