import { useEffect } from "react";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import { consumeSessionReplacedFlag } from "@/lib/auth/session-ended";

/**
 * After the reload that an other-account sign-in forced (`sessionSeen`, a 409 `session_changed`),
 * says why the page started over. The flag is consumed on read, so it shows once. Mount it next to
 * the `<Toaster />`, after it.
 */
export function SessionReplacedToast() {
	useEffect(() => {
		if (consumeSessionReplacedFlag()) toast.info(t("session.replaced"));
	}, []);
	return null;
}
