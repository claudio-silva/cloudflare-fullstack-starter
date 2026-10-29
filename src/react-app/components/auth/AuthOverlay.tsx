import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { LoginForm } from "./LoginForm";
import { Logo } from "../Logo";
import { config } from "../../../config";

/**
 * AuthOverlay - Renders login form as an overlay on the current page.
 * No redirects needed - user stays at the intended URL.
 *
 * Starts below the HTTP layer's banners (`--app-banner-h`), so a sign-in
 * attempted while offline or during maintenance still shows why it waits.
 */
export function AuthOverlay() {
	return (
		<div className="fixed inset-x-0 bottom-0 top-[var(--app-banner-h,0px)] z-50 flex flex-col items-center overflow-auto py-4 px-4">
			<div className="fixed inset-0 bg-linear-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 -z-10" />

			<Card className="relative w-full max-w-md shadow-2xl my-auto">
				<CardHeader className="space-y-6">
					<div className="flex justify-center">
						<Logo className="h-12 w-auto" showTitle={true} />
					</div>
					<CardTitle className="text-center">Authentication Required</CardTitle>
				</CardHeader>
				<CardContent>
					<LoginForm showSignupLink={config.auth.enableSignups} />
				</CardContent>
			</Card>
		</div>
	);
}
