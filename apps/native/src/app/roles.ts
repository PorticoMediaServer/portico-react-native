/** An owner or admin runs the server (libraries, sharing, invitations); a member only uses it. */
export const managesServer = (role: string | undefined): boolean => role === 'owner' || role === 'admin';
