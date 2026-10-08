import React, {createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {FormSet, type AnyDraftForm, type DraftForm, type FormState} from '../../../../../packages/client-core/src/server-admin/draft-form';
import {createServerForm, formValue, withFormValue, type ServerFormDeps, type ServerFormId} from '../../../../../packages/client-core/src/server-admin/server-forms';
import {serverChoices, serverRowShown, type ServerSettingRow} from '../../../../../packages/client-core/src/presentation/index';
import type {MessageId} from '../../../../../packages/i18n/src/index';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {operationId, problem, useConsole, useServerId} from '../../app/server-console';
import {Button, Field, ListRow, Menu, Notice, Sheet, Text, ToggleRow, useTheme, type MenuItem} from '../../ui';

/**
 * A Server page's forms (client-core `server-admin`): one `FormSet` per page, so the page has one
 * Save and one Discard, as on the web. A form is created the first time a row or panel asks for
 * it; everything on the page that edits the same document shares the one draft.
 */
type AnyForm = DraftForm<any, any>;
type PageForms = Readonly<{set: FormSet; deps: ServerFormDeps; form: (id: ServerFormId) => AnyForm}>;
const Ctx = createContext<PageForms | null>(null);

export function ServerFormsProvider({children}: {children: React.ReactNode}) {
  const {api} = useSession();
  const client = useConsole();
  const serverId = useServerId();
  const value = useMemo<PageForms>(() => {
    const set = new FormSet();
    const deps: ServerFormDeps = {api, console: client, serverId, operationId};
    const made = new Map<ServerFormId, AnyForm>();
    return {
      set, deps,
      form: id => {
        let form = made.get(id);
        if (!form) {
          form = createServerForm(id, deps);
          made.set(id, form);
          set.add(id, form as AnyDraftForm);
          void form.load();
        }
        return form;
      },
    };
  }, [api, client, serverId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function usePageForms(): PageForms {
  const forms = useContext(Ctx);
  if (!forms) throw new Error('Server forms are used inside a Server page.');
  return forms;
}

/** One of the page's forms and its state. */
export function useServerForm<T extends object = any, S = any>(id: ServerFormId): {form: DraftForm<T, S>; state: FormState<T, S>} {
  const form = usePageForms().form(id) as DraftForm<T, S>;
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot);
  return {form, state};
}

/** Whether none of these forms exists on this server (features that are not set up): their rows group is left out. */
export function useFormsAbsent(ids: readonly ServerFormId[]): boolean {
  const forms = usePageForms();
  let absent = ids.length > 0;
  // The ids of a section are authored and never change between renders, so the hook count is stable.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  for (const id of ids) { const form = forms.form(id); if (!useSyncExternalStore(form.subscribe, form.getSnapshot).unavailable) absent = false; }
  return absent;
}

export function useServerDeps(): ServerFormDeps {
  return usePageForms().deps;
}

/** Reads every form of the page again (pull to refresh). */
export function useReloadForms(): () => void {
  const {set} = usePageForms();
  return () => { for (const id of ['runtime', 'connectivity', 'remote', 'certificate', 'alerts', 'liveDefaults', 'recording', 'maintenance', 'logs'] as const) void set.get<AnyDraftForm>(id)?.load(); };
}

type InlineState = {dirty: boolean; save: () => Promise<void>; discard: () => void; problem?: string};

/** A panel's own draft as one of the page's forms. */
class InlineForm implements AnyDraftForm {
  current: InlineState;
  private saving = false;
  private saveError: unknown;
  private listeners = new Set<() => void>();
  private state: FormState<object, unknown>;
  constructor(initial: InlineState) { this.current = initial; this.state = this.compute(); }
  private compute(): FormState<object, unknown> { return Object.freeze({loading: false, unavailable: false, dirty: this.current.dirty, saving: this.saving, saveError: this.saveError, problem: this.current.dirty ? this.current.problem : undefined}); }
  private publish() { this.state = this.compute(); for (const fn of this.listeners) fn(); }
  update(next: InlineState) { const changed = next.dirty !== this.current.dirty || next.problem !== this.current.problem; this.current = next; if (changed) { if (!next.dirty) this.saveError = undefined; this.publish(); } }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  load = async () => {};
  discard = () => { this.saveError = undefined; this.current.discard(); this.publish(); };
  save = async () => {
    if (!this.current.dirty || this.saving) return;
    this.saving = true; this.saveError = undefined; this.publish();
    try { await this.current.save(); } catch (error) { this.saveError = error; throw error; } finally { this.saving = false; this.publish(); }
  };
  dispose = () => { this.listeners.clear(); };
}

/** A panel that keeps its own draft joins the page's one Save: it says whether it is dirty and how to save and discard. */
export function useInlineForm(id: string, form: InlineState): {saving: boolean; error?: unknown} {
  const {set} = usePageForms();
  const adapter = useRef<InlineForm | null>(null);
  if (!adapter.current) adapter.current = new InlineForm(form);
  useEffect(() => { adapter.current!.update(form); });
  useEffect(() => set.add('inline:' + id, adapter.current!), [set, id]);
  const state = useSyncExternalStore(adapter.current.subscribe, adapter.current.getSnapshot);
  return {saving: state.saving, error: state.saveError};
}

/** A row whose value is typed: it shows the value and opens a sheet with the field. */
export function TypedRow({title, help, value, shown, placeholder, numeric, multiline, mono, maxLength, onDone}: {title: string; help?: string; /** What the field starts with. */ value: string; /** What the row shows; defaults to the value. */ shown?: string; placeholder?: string; numeric?: boolean; multiline?: boolean; mono?: boolean; maxLength?: number; onDone: (text: string) => void}) {
  const i18n = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const start = () => { setText(value); setOpen(true); };
  const display = shown ?? value;
  return (
    <>
      <ListRow title={title} subtitle={multiline || mono ? [help, display].filter(Boolean).join('\n') || undefined : help} meta={multiline || mono ? undefined : display || placeholder} accessory="navigation" onPress={start} />
      <Sheet open={open} onClose={() => setOpen(false)} title={title} kind="form" primary={{label: i18n.t('action.done'), onPress: () => { onDone(text); setOpen(false); }}}>
        <Field accessibilityLabel={title} hint={help} value={text} onChangeText={setText} placeholder={placeholder} keyboardType={numeric ? 'number-pad' : 'default'} multiline={multiline} maxLength={maxLength} autoCapitalize="none" autoCorrect={false} autoFocus />
      </Sheet>
    </>
  );
}

/** A row that opens a list of values. */
export function PickRow({title, help, value, options, onChange, icon}: {title: string; help?: string; value: string; options: readonly {id: string; label: string}[]; onChange: (id: string) => void; icon?: React.ComponentProps<typeof ListRow>['icon']}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ListRow icon={icon} title={title} subtitle={help} meta={options.find(o => o.id === value)?.label ?? value} accessory="value" onPress={() => setOpen(true)} />
      <Menu open={open} onClose={() => setOpen(false)} title={title} items={options.map<MenuItem>(o => ({id: o.id, label: o.label, selected: o.id === value}))} onSelect={onChange} />
    </>
  );
}

/** One server setting, drawn from its authored row. */
export function ServerSettingRowView({row}: {row: ServerSettingRow}) {
  const i18n = useI18n();
  const t = i18n.t;
  const {form, state} = useServerForm(row.form);
  if (state.draft === undefined) return null;
  const read = (key: string) => formValue(state.draft, key);
  if (!serverRowShown(row, read)) return null;
  const value = read(row.key);
  const write = (next: unknown) => form.set((draft: object) => withFormValue(draft, row.key, next));
  const title = t(row.label);
  const restart = row.form === 'runtime' && (state.status as {restartFields?: readonly string[]} | undefined)?.restartFields?.includes(row.key) ? t('settings.save.afterRestart') : undefined;
  const help = [row.help ? t(row.help) : undefined, restart].filter(Boolean).join(' ') || undefined;
  const control = row.control;
  switch (control.type) {
    case 'switch': return <ToggleRow title={title} subtitle={help} value={value === true} onChange={write} />;
    case 'choice': {
      const known = control.choices.some(c => c.value === value);
      const options = [...(known ? [] : [{id: String(value), label: String(value)}]), ...control.choices.map(c => ({id: String(c.value), label: t(c.label as MessageId, c.labelValues)}))];
      return <PickRow title={title} help={help} value={String(value)} options={options} onChange={id => { const picked = control.choices.find(c => String(c.value) === id); if (picked) write(picked.value); }} />;
    }
    case 'choiceFrom': {
      const options = serverChoices(control.source, state.status, t, typeof value === 'string' ? value : undefined);
      return <PickRow title={title} help={help} value={String(value ?? '')} options={options.map(o => ({id: o.value, label: o.label}))} onChange={write} />;
    }
    case 'number': {
      const scale = control.scale ?? 1;
      const empty = control.empty && (value === control.empty.stores || value === null);
      const typed = empty ? '' : String(Math.round(Number(value) / scale));
      const unit = control.unit ? t(control.unit) : '';
      const parse = (text: string) => {
        if (text.trim() === '' && control.empty) return write(control.empty.stores);
        const n = Math.floor(Number(text));
        if (!Number.isFinite(n)) return;
        write(Math.min(control.max, Math.max(control.min, n)) * scale);
      };
      return <TypedRow title={title} help={help} value={typed} shown={empty && control.empty ? t(control.empty.placeholder) : [typed, unit].filter(Boolean).join(' ')} placeholder={control.empty ? t(control.empty.placeholder) : undefined} numeric onDone={parse} />;
    }
    case 'text': return <TypedRow title={title} help={help} value={typeof value === 'string' ? value : ''} placeholder={control.example} mono={control.mono} maxLength={control.maxLength} onDone={write} />;
    case 'lines': {
      const lines = Array.isArray(value) ? (value as readonly string[]) : [];
      return <TypedRow title={title} help={help} value={lines.join('\n')} placeholder={control.example} multiline onDone={text => write(text.split('\n').map(x => x.trim()).filter(Boolean))} />;
    }
  }
}

/** What a form could not load, above its rows; nothing when it loaded or the feature is absent. */
export function FormLoadNotice({id}: {id: ServerFormId}) {
  const i18n = useI18n();
  const {form, state} = useServerForm(id);
  if (!state.loadError) return null;
  return <Notice tone={state.saved ? 'warning' : 'error'} message={problem(state.loadError)} action={i18n.t('action.tryAgain')} onAction={() => void form.load()} />;
}

/** Whether the page has unsaved changes. */
export function usePageDirty(): boolean {
  const {set} = usePageForms();
  return useSyncExternalStore(set.subscribe, () => set.getSnapshot().dirty);
}

/** The page's one Save / Discard, at the bottom of the screen while anything on the page is unsaved. */
export function SaveBar() {
  const i18n = useI18n();
  const t = i18n.t;
  const {colors, space} = useTheme();
  const {set} = usePageForms();
  const state = useSyncExternalStore(set.subscribe, set.getSnapshot);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);
  const blocked = state.problem ? (i18n.has(state.problem) ? t(state.problem as MessageId) : state.problem) : undefined;
  const failed = state.saveError !== undefined ? problem(state.saveError, 'action') || t('settings.save.failed') : undefined;
  if (!state.dirty && !saved && !failed) return null;
  return (
    <View accessibilityRole="toolbar" style={{flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.page, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.raised}}>
      <Text variant="caption" tone={blocked || failed ? 'danger' : 'secondary'} style={{flex: 1}} lines={2}>{blocked ?? failed ?? (state.dirty ? t('settings.save.unsaved') : t('settings.save.saved'))}</Text>
      {state.dirty ? <Button variant="ghost" label={t('action.discard')} disabled={state.saving} onPress={() => set.discard()} /> : null}
      {state.dirty ? <Button variant="primary" label={t('action.save')} disabled={!!blocked} loading={state.saving} onPress={() => void set.save().then(ok => setSaved(ok))} /> : null}
    </View>
  );
}
