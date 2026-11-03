/**
 * The background of the sign-in card and the other auth pages: a diagonal
 * gradient that reads the same in both themes, from white to a cool grey in
 * light, from near-black to slate in dark.
 */
export function AuthBackdrop() {
	return <div className="fixed inset-0 -z-10 bg-linear-to-br from-white to-slate-300 dark:from-slate-950 dark:to-slate-900" />;
}
