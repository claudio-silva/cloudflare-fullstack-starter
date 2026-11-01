/**
 * The contact form, sent without leaving the page.
 *
 * Optional: without this script the form posts the ordinary way and the Worker
 * redirects back to `#contact-<outcome>`, which the page shows with `:target`
 * (src/contact.ts). With it, the answer appears in place, the fields the
 * server rejected are marked, and the time since the page loaded goes along —
 * the cheapest bot check there is.
 */
const form = document.querySelector("form[data-contact]");

if (form) {
	const status = form.querySelector("[data-contact-status]");
	const submit = form.querySelector('button[type="submit"]');
	const started = form.querySelector('input[name="started"]');
	if (started) started.value = String(Date.now());

	const show = (outcome, message) => {
		form.dataset.state = outcome;
		status.textContent = message;
	};

	const markFields = (fields = {}) => {
		for (const input of form.querySelectorAll("input[name], textarea[name]")) {
			const problem = fields[input.name];
			const hint = form.querySelector(`[data-error-for="${input.name}"]`);
			input.toggleAttribute("aria-invalid", Boolean(problem));
			if (hint) hint.textContent = problem ?? "";
		}
		const first = form.querySelector("[aria-invalid]");
		if (first) first.focus();
	};

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (form.dataset.state === "sending") return;
		markFields();
		show("sending", "Sending…");
		submit.disabled = true;

		try {
			// The site's own endpoint, not the app's API: the site has no HTTP layer to go through.
			const response = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { accept: "application/json" } });
			const body = await response.json().catch(() => ({ outcome: "failed", message: "Something went wrong. Please try again." }));
			show(body.outcome, body.message);
			if (body.fields) markFields(body.fields);
			if (body.ok) {
				form.reset();
				if (started) started.value = String(Date.now());
			}
		} catch {
			show("failed", "You seem to be offline. Your message is still here — try again when you're back.");
		} finally {
			submit.disabled = false;
		}
	});
}
