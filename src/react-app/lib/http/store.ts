/**
 * A value that the HTTP layer changes and React renders.
 *
 * The layer runs outside React (it patches `fetch`), so its state lives here
 * and components read it with `useSyncExternalStore`.
 */
export type Store<T> = {
	get(): T;
	set(next: T): void;
	subscribe(listener: () => void): () => void;
};

export function createStore<T>(initial: T): Store<T> {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		set(next) {
			if (Object.is(next, value)) return;
			value = next;
			for (const l of listeners) l();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
