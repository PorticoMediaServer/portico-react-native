import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {ConsoleClient} from '../../../../../../../packages/client-core/src/console';
import {FormSet, type DraftForm, type FormState} from '../../../../../../../packages/client-core/src/server-admin/draft-form';
import {createServerForm, type ServerFormDeps, type ServerFormId} from '../../../../../../../packages/client-core/src/server-admin/server-forms';
import {nativeRouteCrypto} from '../../../../platform/server-connections';
import type {NativeSettingsLivePorts} from '../../ports';

const operationHex = (): string => [...nativeRouteCrypto.random(24)].map(byte => byte.toString(16).padStart(2, '0')).join('');

export type StorageForms = Readonly<{
  forms: Readonly<Record<ServerFormId, DraftForm<any, any>>>;
  set: FormSet;
  state: ReturnType<FormSet['getSnapshot']>;
}>;

/** The Storage page's three settings documents behind one Save, as the web page has. */
export function useStorageForms(ports: NativeSettingsLivePorts, ids: readonly ServerFormId[]): StorageForms {
  const context = ports.context, authority = context.authority();
  const api = useMemo(() => ({request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => context.api.request<T>(path, method, body, signal)}), [context]);
  const deps = useMemo<ServerFormDeps>(() => ({
    api,
    console: new ConsoleClient(api, {serverId: authority.serverId, viewerId: authority.profileId}),
    serverId: authority.serverId,
    operationId: operationHex,
  }), [api, authority]);
  const set = useMemo(() => new FormSet(), []);
  const forms = useMemo(() => {
    const made: Partial<Record<ServerFormId, DraftForm<any, any>>> = {};
    for (const id of ids) {const form = createServerForm(id, deps); set.add(id, form); made[id] = form;}
    return made as Record<ServerFormId, DraftForm<any, any>>;
  }, [ids, deps, set]);
  useEffect(() => {
    for (const form of Object.values(forms)) void form.load();
    return () => {for (const form of Object.values(forms)) form.dispose(); deps.console.dispose(); set.discard();};
  }, [forms, deps, set]);
  const state = useSyncExternalStore(set.subscribe, set.getSnapshot);
  return {forms, set, state};
}

export function useFormState<T extends object, S>(form: DraftForm<any, any>): FormState<T, S> {
  return useSyncExternalStore(form.subscribe, form.getSnapshot) as FormState<T, S>;
}
