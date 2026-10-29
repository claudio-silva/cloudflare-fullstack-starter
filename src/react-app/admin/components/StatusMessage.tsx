import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ACTION_BUTTON } from "../styles";

function StatusMessage({ code, message, home }: { code: number; message: string; home: { to: string; label: string } }) {
	return (
		<div className="flex h-full flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
			<h1 className="text-5xl font-bold">{code}</h1>
			<p className="text-lg text-muted-foreground">{message}</p>
			<Button asChild className={ACTION_BUTTON}>
				<Link to={home.to}>{home.label}</Link>
			</Button>
		</div>
	);
}

/** The area or the page needs a higher role. */
export const Forbidden = ({ inArea = false }: { inArea?: boolean }) => (
	<StatusMessage
		code={403}
		message="You don't have access to this page."
		home={inArea ? { to: "/admin", label: "Dashboard" } : { to: "/", label: "Go home" }}
	/>
);

export const AdminNotFound = () => (
	<StatusMessage code={404} message="This page could not be found." home={{ to: "/admin", label: "Dashboard" }} />
);
