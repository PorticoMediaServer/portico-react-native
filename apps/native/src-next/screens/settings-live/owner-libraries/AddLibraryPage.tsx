import React, {useEffect, useMemo, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import type {LibraryContentApi} from '../../../../../../packages/client-core/src/library-content';
import type {ManagedLibrary} from '../../../../../../packages/client-core/src/library-management';
import {kindMetadataAgentsPath, parseKindMetadataAgents, type MetadataAgentOption} from '../../../../../../packages/client-core/src/server-admin/metadata-agent';
import type {MessageId} from '../../../../../../packages/i18n/src/index';
import {defaultI18n} from '../../../../../../packages/i18n/src/index';
import {Button} from '../../../kit/controls/Button';
import {Focusable} from '../../../kit/controls/Focusable';
import {TextField} from '../../../kit/controls/TextField';
import {Select} from '../../../kit/controls/Select';
import {languageName} from '../../../../../../packages/client-core/src/presentation/language-list';
import {Icon} from '../../../kit/Icon';
import {useTheme} from '../../../kit/theme';
import {alpha, shellType} from '../../../kit/shell/visual';
import {LibraryGroup, LibraryRow, SectionTitle} from './controls';
import {FolderExplorer, type ExplorerFolder} from './FolderExplorer';
import {ownerLibraryKind, ownerLibraryKinds} from './presentation';

export type AddLibraryInput = Readonly<{name: string; kind: ManagedLibrary['kind']; folders: readonly string[]; metadataAgent?: 'online' | 'local'; metadataLanguage?: string}>;

/** Settings › Server › Libraries › Add library, as one page (frame 17). */
export function AddLibraryPage({api, serverName, onCreate, onCancel, busy, error}: {api: LibraryContentApi; serverName: string; onCreate: (input: AddLibraryInput) => void; onCancel: () => void; busy: boolean; error?: unknown}) {
  const theme = useTheme(), t = defaultI18n.t;
  const [kind, setKind] = useState<ManagedLibrary['kind']>('movie'), [name, setName] = useState(defaultI18n.t('next.ownerLibraries.kind.movie')), [touched, setTouched] = useState(false);
  const [folders, setFolders] = useState<readonly ExplorerFolder[]>([]), [exploring, setExploring] = useState(false);
  const [agents, setAgents] = useState<readonly MetadataAgentOption[]>([]), [agent, setAgent] = useState('online'), [language, setLanguage] = useState<string>();

  useEffect(() => {
    let alive = true;
    api.request<unknown>(kindMetadataAgentsPath(kind)).then(parseKindMetadataAgents).then(
      value => {if (!alive) return; setAgents(value.agents); const chosen = value.agents.find(option => option.id === 'online') ?? value.agents[0];
        if (chosen) {setAgent(current => value.agents.some(option => option.id === current) ? current : chosen.id); setLanguage(chosen.defaultLanguage);}},
      () => {if (alive) setAgents([]);});
    return () => {alive = false;};
  }, [api, kind]);

  const chosenAgent = useMemo(() => agents.find(option => option.id === agent), [agents, agent]);
  const chooseKind = (next: ManagedLibrary['kind']) => {setKind(next); if (!touched) setName(t(ownerLibraryKind(next).label));};
  const valid = name.trim().length > 0 && folders.length > 0;
  return <View style={{flex: 1}}>
    <ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 24}}>
      <Text style={[shellType(13.5, 400, 19), {color: theme.colors.textSecondary}]}>{t('web.libraries.addLede')}</Text>

      <SectionTitle>{t('web.libraries.type')}</SectionTitle>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 10}}>
        {ownerLibraryKinds.map(option => {
          const on = option.kind === kind;
          return <Focusable key={option.kind} accessibilityRole="radio" accessibilityLabel={t(option.label)} accessibilityState={{checked: on}} onPress={() => chooseKind(option.kind)} focusKind="card" focusRadius={14}
            style={{width: '47%', flexGrow: 1, minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: on ? alpha(theme.colors.accent, .16) : theme.colors.raised, borderWidth: 1.5, borderColor: on ? theme.colors.accentStrong : 'transparent'}}>
            <Icon name={option.icon} size={22} color={on ? theme.colors.accentStrong : theme.colors.textSecondary}/>
            <Text numberOfLines={1} style={[shellType(14.5, 700), {color: theme.colors.text, flexShrink: 1}]}>{t(option.label)}</Text>
          </Focusable>;
        })}
      </View>
      <Text style={[shellType(12.5, 500, 17.5), {color: theme.colors.textTertiary, marginTop: 8, paddingHorizontal: 4}]}>{t(ownerLibraryKind(kind).description)}</Text>

      <SectionTitle>{t('next.ownerLibraries.nameLabel')}</SectionTitle>
      <TextField focusId="owner-libraries-add-name" value={name} onChangeText={value => {setName(value); setTouched(true);}} maxLength={100} accessibilityLabel={t('next.ownerLibraries.nameLabel')}/>

      <SectionTitle>{t('next.ownerLibraries.folders')}</SectionTitle>
      <LibraryGroup>
        {folders.map((folder, index) => <LibraryRow key={folder.path} first={index === 0} icon="i-folder" label={folder.name} help={folder.path}
          trailing={<Button variant="icon" size="xs" icon="i-x" accessibilityLabel={t('next.ownerLibraries.explorer.removeChosen')} onPress={() => setFolders(current => current.filter(value => value.path !== folder.path))}/>}/>)}
        <LibraryRow first={!folders.length} icon="i-plus" label={t('next.ownerLibraries.explorer.choose')} onPress={() => setExploring(true)}/>
      </LibraryGroup>
      {!folders.length && <Text style={[shellType(12.5, 500, 17.5), {color: theme.colors.textTertiary, marginTop: 8, paddingHorizontal: 4}]}>{t('next.ownerLibraries.addLibrary.foldersHelp')}</Text>}

      {agents.length > 0 && <>
        <SectionTitle>{t('next.ownerLibraries.metadataSource')}</SectionTitle>
        <LibraryGroup>{agents.map((option, index) => <MetadataAgentChoice key={option.id} option={option} first={index === 0} checked={option.id === agent} onPress={() => {setAgent(option.id); setLanguage(option.defaultLanguage);}}/>)}</LibraryGroup>
        <Text style={[shellType(12.5, 500, 17.5), {color: theme.colors.textTertiary, marginTop: 8, paddingHorizontal: 4}]}>{t('web.metadataSource.saved')}</Text>
      </>}

      {language !== undefined && chosenAgent && chosenAgent.languages.length > 0 && <>
        <SectionTitle>{t('next.ownerLibraries.addLibrary.language')}</SectionTitle>
        <LibraryGroup><LibraryRow first label={t('next.ownerLibraries.addLibrary.language')} help={t('next.ownerLibraries.addLibrary.languageHelp')}
          trailing={<Select testID="owner-libraries-add-language" accessibilityLabel={t('next.ownerLibraries.addLibrary.language')} value={language} options={chosenAgent.languages.map(code => ({value: code, label: languageName(code, key => defaultI18n.has(key) ? defaultI18n.t(key) : undefined)}))} onValueChange={setLanguage} style={{backgroundColor: 'transparent', paddingHorizontal: 0}}/>}/></LibraryGroup>
      </>}

      {error !== undefined && <Text accessibilityRole="alert" style={[shellType(13, 600, 18), {color: theme.colors.record, marginTop: 16}]}>{error instanceof Error ? error.message : t('next.ownerLibraries.saveFailed')}</Text>}
    </ScrollView>
    <View style={{flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.colors.lineSoft, backgroundColor: theme.colors.ink}}>
      <Button variant="glass" size="small" disabled={busy} onPress={onCancel}>{t('action.cancel')}</Button>
      <Button size="small" loading={busy} disabled={!valid || busy} onPress={() => onCreate({name: name.trim(), kind, folders: folders.map(folder => folder.path), ...(agent ? {metadataAgent: agent as 'online' | 'local'} : {}), ...(language ? {metadataLanguage: language} : {})})} style={{flex: 1}}>{t('web.empty.addLibrary')}</Button>
    </View>
    <FolderExplorer open={exploring} onOpenChange={setExploring} api={api} title={t('next.ownerLibraries.explorer.choose')} subtitle={t('next.ownerLibraries.explorer.subtitle', {server: serverName})}
      chosen={folders} onUse={setFolders}/>
  </View>;
}

export function MetadataAgentChoice({option, checked, first, onPress}: {option: Readonly<{id: string; name: string; description: string}>; checked: boolean; first: boolean; onPress: () => void}) {
  const theme = useTheme();
  return <Focusable accessibilityRole="radio" accessibilityLabel={option.name} accessibilityHint={option.description} accessibilityState={{checked}} onPress={onPress} focusKind="row" focusRadius={10}
    style={{flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 52, borderTopWidth: first ? 0 : 1, borderTopColor: theme.colors.lineSoft}}>
    <View style={{width: 21, height: 21, marginTop: 1, borderRadius: 11, borderWidth: 2, borderColor: checked ? theme.colors.accentStrong : theme.colors.lineStrong, alignItems: 'center', justifyContent: 'center'}}>{checked && <View style={{width: 9, height: 9, borderRadius: 5, backgroundColor: theme.colors.text}}/>}</View>
    <View style={{flex: 1}}>
      <Text style={[shellType(15, 600), {color: theme.colors.text}]}>{option.name}</Text>
      {option.description ? <Text style={[shellType(12.5, 500, 17.5), {color: theme.colors.textTertiary, marginTop: 2}]}>{option.description}</Text> : null}
    </View>
  </Focusable>;
}

/** The catalogue's own name for a library kind, for the list's secondary line. */
export function libraryKindName(kind: string): string {return defaultI18n.t(ownerLibraryKind(kind).label as MessageId);}
