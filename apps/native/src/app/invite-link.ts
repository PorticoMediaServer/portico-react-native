/**
 * The link an invitation is shared as (Spec — Hosted at Scale): the web app's `/join` page with the
 * one-time code and the inviting server's address in the fragment (never sent to a server by the
 * browser). It opens the app where it is installed, the web join page anywhere else.
 */
export function inviteLink(webOrigin: string, serverBase: string, code: string): string {
  const web = new URL(webOrigin).origin;
  const server = new URL(serverBase).origin;
  const hash = `code=${encodeURIComponent(code)}`;
  return server === web ? `${web}/join#${hash}` : `${web}/join#${hash}&server=${encodeURIComponent(server)}`;
}
