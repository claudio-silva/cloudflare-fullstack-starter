import { config } from "../../config";

const APP_NAME = config.appName;

/**
 * Simple verification email template with placeholder branding.
 */
export function getVerificationEmailTemplate(userName: string, verificationUrl: string): string {
	const safeName = userName || "there";
	return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your email</title>
</head>
<body style="margin:0;padding:0;font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;background-color:#f5f5f5;">
  <table role="presentation" style="width:100%;border-collapse:collapse;background-color:#f5f5f5;">
    <tr>
      <td style="padding:40px 20px;">
        <table role="presentation" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding:40px;">
              <div style="text-align:center;margin-bottom:24px;">
                <h1 style="margin:0;font-size:28px;color:#1f315c;font-weight:600;">${APP_NAME}</h1>
              </div>
              <h2 style="font-size:22px;margin:0 0 12px;color:#1f315c;text-align:center;">Verify your email address</h2>
              <p style="color:#444;font-size:16px;line-height:1.6;margin:0 0 24px;text-align:center;">
                Hi ${safeName}, thanks for signing up!<br>Please verify your email to continue.
              </p>
              <div style="text-align:center;margin:28px 0;">
                <a href="${verificationUrl}" style="display:inline-block;padding:14px 28px;background-color:#1f315c;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;">
                  Verify Email
                </a>
              </div>
              <p style="color:#777;font-size:14px;line-height:1.6;margin:0 0 12px;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="color:#1f315c;font-size:14px;line-height:1.6;margin:0;word-break:break-all;">
                <a href="${verificationUrl}" style="color:#1f315c;text-decoration:underline;">${verificationUrl}</a>
              </p>
              <p style="color:#999;font-size:12px;line-height:1.6;margin:24px 0 0;">
                If you didn't request this, you can safely ignore this email.
              </p>
              <p style="color:#999;font-size:12px;line-height:1.6;margin:8px 0 0;">
                © ${new Date().getFullYear()} ${APP_NAME}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
	`.trim();
}

/**
 * Password reset email template.
 */
export function getPasswordResetEmailTemplate(userName: string, resetUrl: string): string {
	const safeName = userName || "there";
	return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;background-color:#f5f5f5;">
  <table role="presentation" style="width:100%;border-collapse:collapse;background-color:#f5f5f5;">
    <tr>
      <td style="padding:40px 20px;">
        <table role="presentation" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding:40px;">
              <div style="text-align:center;margin-bottom:24px;">
                <h1 style="margin:0;font-size:28px;color:#1f315c;font-weight:600;">${APP_NAME}</h1>
              </div>
              <h2 style="font-size:22px;margin:0 0 12px;color:#1f315c;text-align:center;">Reset your password</h2>
              <p style="color:#444;font-size:16px;line-height:1.6;margin:0 0 24px;text-align:center;">
                Hi ${safeName}, we received a request to reset your password. Click the button below to choose a new password.
              </p>
              <div style="text-align:center;margin:28px 0;">
                <a href="${resetUrl}" style="display:inline-block;padding:14px 28px;background-color:#1f315c;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;">
                  Reset Password
                </a>
              </div>
              <p style="color:#777;font-size:14px;line-height:1.6;margin:0 0 12px;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="color:#1f315c;font-size:14px;line-height:1.6;margin:0;word-break:break-all;">
                <a href="${resetUrl}" style="color:#1f315c;text-decoration:underline;">${resetUrl}</a>
              </p>
              <p style="color:#999;font-size:12px;line-height:1.6;margin:24px 0 0;">
                If you didn't request this, you can safely ignore this email. Your password will not be changed.
              </p>
              <p style="color:#999;font-size:12px;line-height:1.6;margin:8px 0 0;">
                This link will expire in 1 hour.
              </p>
              <p style="color:#999;font-size:12px;line-height:1.6;margin:8px 0 0;">
                © ${new Date().getFullYear()} ${APP_NAME}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
	`.trim();
}
