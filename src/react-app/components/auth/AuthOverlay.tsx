import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { LoginForm } from "./LoginForm";

export function AuthOverlay() {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
			<div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900" />
			<Card className="relative w-full max-w-md mx-4 shadow-2xl">
				<CardHeader className="space-y-6 text-center">
					<CardTitle>Authentication Required</CardTitle>
				</CardHeader>
				<CardContent>
					<LoginForm showSignupLink />
				</CardContent>
			</Card>
		</div>
	);
}
