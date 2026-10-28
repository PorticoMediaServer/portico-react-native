/** Keep the server's event vocabulary and order; selections in other groups survive All/None. */
export function webhookEventGroups(events: readonly string[]): readonly Readonly<{prefix: string; events: readonly string[]}>[] {
  const groups = new Map<string, string[]>();
  for (const event of events) {
    const prefix = event.split('.')[0];
    const values = groups.get(prefix) ?? [];
    if (!values.includes(event)) values.push(event);
    groups.set(prefix, values);
  }
  return [...groups].map(([prefix, values]) => ({prefix, events: values}));
}
export function selectWebhookEventGroup(selected: readonly string[], group: readonly string[], enabled: boolean): readonly string[] {
  return enabled ? [...new Set([...selected, ...group])] : selected.filter(event => !group.includes(event));
}
export function webhookSecretChange(secret: string): {secret: string} | {rotateSecret: true} {
  // An explicitly supplied secret is opaque; whitespace is never silently changed.
  return secret.length ? {secret} : {rotateSecret: true};
}
