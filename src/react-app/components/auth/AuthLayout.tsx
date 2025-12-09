import { ReactNode } from "react";

interface AuthLayoutProps {
	children: ReactNode;
	title?: string;
	description?: string;
}

export function AuthLayout({ children, title, description }: AuthLayoutProps) {
	return (
		<div className="min-h-screen flex items-center justify-center bg-background p-4">
			<div className="w-full max-w-md">
				{(title || description) && (
					<div className="text-center mb-6">
						{title && <h1 className="text-2xl font-semibold text-foreground mb-2">{title}</h1>}
						{description && <p className="text-sm text-muted-foreground">{description}</p>}
					</div>
				)}
				{children}
			</div>
		</div>
	);
}
