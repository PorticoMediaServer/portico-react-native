/** The link the TV's QR code opens: the server's own `/device` page (with the code in the fragment,
 * which the web page reads and never sends). The server's answer is used when it is on this server. */
export function approvalLink(serverOrigin: string, given: string | undefined, code: string): string {
  const base = serverOrigin.replace(/\/+$/, '');
  try {
    if (given && new URL(given).origin === new URL(base).origin) return given;
  } catch {
    // Not a URL: use this server's page.
  }
  return `${base}/device${code ? `#code=${encodeURIComponent(code)}` : ''}`;
}
