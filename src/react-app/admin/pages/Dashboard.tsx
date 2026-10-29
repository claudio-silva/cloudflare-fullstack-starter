import { PanelLeft, PanelTop } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AdminPage } from "../components/AdminPage";
import { setNavigationMode, useNavigationMode, type NavigationMode } from "../nav";

export function Dashboard() {
	const mode = useNavigationMode();

	return (
		<AdminPage
			title="Dashboard"
			actions={
				<ToggleGroup
					type="single"
					variant="outline"
					value={mode}
					onValueChange={(value) => value && setNavigationMode(value as NavigationMode)}
					aria-label="Menu layout"
				>
					<ToggleGroupItem value="sidebar" aria-label="Vertical menu" className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
						<PanelLeft />
						Vertical
					</ToggleGroupItem>
					<ToggleGroupItem value="topbar" aria-label="Horizontal menu" className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
						<PanelTop />
						Horizontal
					</ToggleGroupItem>
				</ToggleGroup>
			}
		>
			<div className="flex flex-1 items-center justify-center py-16">
				<p className="max-w-2xl text-center text-4xl font-semibold tracking-tight text-balance md:text-5xl">
					Welcome to the administration area
				</p>
			</div>
		</AdminPage>
	);
}
