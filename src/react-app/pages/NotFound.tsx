import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFound() {
	return (
		<div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
			<h1 className="text-5xl font-bold">404</h1>
			<p className="text-lg text-muted-foreground">This page could not be found.</p>
			<Button asChild>
				<Link to="/">Go home</Link>
			</Button>
		</div>
	);
}
