/**
 * Email adapter contract. Any provider that can implement `sendEmail` can be
 * plugged in; the rest of the app only depends on this interface.
 */
export type EmailMessage = {
	to: string;
	subject: string;
	html: string;
	/** Plain-text alternative. Adapters derive one from `html` when omitted. */
	text?: string;
};

export type EmailSender = {
	sendEmail: (message: EmailMessage) => Promise<void>;
};

/** Sender identity, taken from `src/config.ts` (`appName`, `email.fromAddress`). */
export type EmailIdentity = {
	name: string;
	address: string;
};
