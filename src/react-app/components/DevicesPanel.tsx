import { useCallback, useEffect, useState } from "react";
import { Laptop, LogOut, Smartphone, Tablet, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Panel } from "@/components/Panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { countryName } from "@/lib/country";
import { getLocale } from "@/lib/i18n";
import { http, isHandledHttpError } from "@/lib/http";
import { authClient } from "@/lib/auth/client";
import type { UserSession, UserSessionList } from "../../shared/sessions";

/** "Active now", "Last active 7 minutes ago". */
function lastActive(session: UserSession): string {
	if (session.status === "active") return "Active now";
	const minutes = Math.round(session.idleSeconds / 60);
	const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
	const ago = minutes < 60 ? format.format(-minutes, "minute") : minutes < 60 * 24 ? format.format(-Math.round(minutes / 60), "hour") : format.format(-Math.round(minutes / 1440), "day");
	return `Last active ${ago}`;
}

const DeviceIcon = ({ device }: { device: string }) => (device.endsWith("Mobile") ? <Smartphone /> : device.endsWith("Tablet") ? <Tablet /> : <Laptop />);

/**
 * "Where you're signed in": the user's sessions, one per device, with the one
 * in use marked and a way to end any of them, this one included (or all the others). They come from
 * `/api/profile/sessions` (`src/worker/routes/sessions.ts`), which never sends
 * a session's token.
 */
export function DevicesPanel() {
	const [sessions, setSessions] = useState<UserSession[] | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const navigate = useNavigate();

	const load = useCallback(async () => {
		try {
			const res = await http("/api/profile/sessions");
			setSessions(((await res.json()) as UserSessionList).sessions);
		} catch (error) {
			if (!isHandledHttpError(error)) toast.error("Your devices could not be loaded.");
			setSessions((current) => current ?? []);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);

	/** Ends one session, or every other one (`id` null). A failure is shown by the HTTP layer; either way the list is read again. */
	const end = async (id: string | null) => {
		setBusy(id ?? "all");
		try {
			await http(id ? `/api/profile/sessions/${encodeURIComponent(id)}` : "/api/profile/sessions/sign-out-others", { method: id ? "DELETE" : "POST" });
			toast.success(id ? "Signed out of that device." : "Signed out of all other devices.");
		} catch (error) {
			if (!isHandledHttpError(error)) toast.error("The session could not be ended.");
		} finally {
			setBusy(null);
			await load();
		}
	};

	/** Signs this device out, as the user menu does, and goes to the home page. */
	const signOut = () => authClient.signOut({ fetchOptions: { onSuccess: () => navigate("/", { replace: true }) } });

	const others = sessions?.filter((s) => !s.current).length ?? 0;

	return (
		<Panel title="Where you're signed in" description="The devices that are signed in to your account. If you don't recognise one, sign it out and change your password.">
			{sessions === null ? (
				<div className="space-y-3">
					<Skeleton className="h-14" />
					<Skeleton className="h-14" />
				</div>
			) : (
				<div className="space-y-4">
					{/* A container: each row puts its button beside the text only where there is room for both. */}
					<ItemGroup className="@container rounded-md border">
						{sessions.map((session, index) => (
							<div key={session.id}>
								{index > 0 && <ItemSeparator className="my-0" />}
								<Item size="sm" className="flex-nowrap items-start">
									<ItemMedia variant="icon">
										<DeviceIcon device={session.device} />
									</ItemMedia>
									<div className="flex min-w-0 flex-1 flex-col items-start gap-2.5 @md:flex-row @md:items-center @md:justify-between @md:gap-4">
										<ItemContent className="min-w-0">
											<ItemTitle className="flex-wrap">
												<span title={session.userAgent ?? undefined}>{session.device}</span>
												{session.current && <Badge variant="secondary">This device</Badge>}
											</ItemTitle>
											<ItemDescription className="line-clamp-none">
												{/* One fact per line, so none is broken across two. */}
												<span className="block">{[session.ip, session.country && countryName(session.country)].filter(Boolean).join(" · ")}</span>
												<span className="block">{lastActive(session)}</span>
												<span className="block">Signed in {new Date(session.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
											</ItemDescription>
										</ItemContent>
										<ItemActions>
											{/* This device too: signing out here is the ordinary sign-out. */}
											<Button variant="outline" size="sm" disabled={busy !== null} onClick={() => (session.current ? void signOut() : end(session.id))}>
												{busy === session.id ? <Spinner /> : <LogOut />}
												Sign out
											</Button>
										</ItemActions>
									</div>
								</Item>
							</div>
						))}
						{sessions.length === 0 && <div className="p-4 text-sm text-muted-foreground">No devices to show.</div>}
					</ItemGroup>
					{others > 0 && (
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant="outline" className="max-w-full" disabled={busy !== null}>
									{busy === "all" ? <Spinner /> : <LogOut />}
									Sign out other devices
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Sign out of all other devices?</AlertDialogTitle>
									<AlertDialogDescription>
										{others === 1 ? "The other device is" : `The other ${others} devices are`} signed out and must sign in again. This device stays signed in.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel className="w-40">
										<X />
										Cancel
									</AlertDialogCancel>
									<AlertDialogAction onClick={() => end(null)} className="w-40">
										<LogOut />
										Sign out
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					)}
				</div>
			)}
		</Panel>
	);
}
