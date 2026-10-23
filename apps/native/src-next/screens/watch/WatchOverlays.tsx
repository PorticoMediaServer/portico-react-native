import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Modal, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {deletionAllowed} from '../../../../../packages/client-core/src/administration';
import {mergeExplanation} from '../../../../../packages/client-core/src/title-identity';
import type {NativeShellRuntime} from '../../shell/runtime';
import {shellLayout} from '../../shell/model';
import {Button, TextField} from '../../kit/controls';
import {Artwork} from '../../kit/artwork';
import {StateView} from '../../kit/states';
import {BottomSheet, Dialog, Menu, type MenuEntry} from '../../kit/overlays';
import {TouchMenuHeader} from '../../kit/overlays/Menu';
import {FocusBoundary, PanelBackground} from '../../kit/overlays/surface';
import {useOverlayLifecycle} from '../../kit/overlays/OverlayHost';
import {nativeType, useTheme} from '../../kit/theme';
import type {NativeScreenServices} from '../screen-services';
import type {NativeWatchOverlay, NativeWatchPresenters} from './presenters';

const named = (entry: NativeWatchOverlay['capture']['entry']) => entry.displayTitle ?? entry.title;

/** The authored File info container; the native video stays in its persistent
 * host below this overlay. TV chrome alone uses the1920 canvas once. */
function FileInfoSurface({value, presenters}: {value: NativeWatchOverlay; presenters: NativeWatchPresenters}) {
  const theme = useTheme(), window = useWindowDimensions(), done = useRef<View>(null), t = defaultI18n.t;
  useOverlayLifecycle(theme.isTV, true, presenters.close, done, value.anchorRef, 0, 'watch-file-info');
  const action = <Button ref={done} testID="watch-file-info-done" variant={theme.isTV ? 'primary' : 'glass'} size={theme.isTV ? 'hero' : 'small'} hasTVPreferredFocus onPress={presenters.close}>{t('next.overlays.done')}</Button>;
  if (theme.isTV) {
    const canvas = shellLayout(window.width, window.height, true);
    return <Modal transparent visible animationType="none" onRequestClose={presenters.close} statusBarTranslucent navigationBarTranslucent>
      <View style={[StyleSheet.absoluteFill, {backgroundColor: '#04090d9e'}]} accessibilityViewIsModal>
        <View pointerEvents="box-none" style={{position: 'absolute', left: canvas.left, top: canvas.top, width: canvas.width, height: canvas.height, transformOrigin: 'top left', transform: [{scale: canvas.scale}]}}>
          <FocusBoundary modal testID="watch-file-info-tv" style={{position: 'absolute', right: 0, top: 0, bottom: 0, width: 900, paddingTop: 64, paddingLeft: 56, paddingRight: 96, paddingBottom: 56}}>
            <PanelBackground/>
            <Text style={[nativeType({size: 22, weight: 400, tracking: 0, lineHeight: 33}), {color: theme.colors.textTertiary}]}>{t('next.overlays.fileInfo')}</Text>
            <Text numberOfLines={2} style={[nativeType({size: 46, weight: 800, tracking: -.035, lineHeight: 48}), {color: theme.colors.text, marginTop: 18}]}>{named(value.capture.entry)}</Text>
            <View style={{flex: 1, marginTop: 30}}>{value.content}</View>
            <View style={{marginTop: 24, height: 72, alignItems: 'flex-start'}}>{action}</View>
          </FocusBoundary>
        </View>
      </View>
    </Modal>;
  }
  return <BottomSheet testID="watch-file-info-phone" open onOpenChange={open => {if (!open) presenters.close();}} title={t('next.overlays.fileInfo')}
    showClose={false} initialFocusRef={done} returnFocusRef={value.anchorRef} scrollable={false} detents={[Math.max(1, window.height - 104)]}
    headerContent={<View style={{paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10}}>
      <Text style={[nativeType({size: 21, weight: 800, tracking: -.02, lineHeight: 'normal'}), {color: theme.colors.text}]}>{t('next.overlays.fileInfo')}</Text>
      <Text numberOfLines={1} style={[theme.type.caption, {color: theme.colors.textTertiary, flex: 1, fontSize: 14}]}>{named(value.capture.entry)}</Text>{action}
    </View>} contentStyle={{paddingHorizontal: 16, paddingTop: 8, flex: 1}}>{value.content}</BottomSheet>;
}

function ManageSurface({value, presenters, common}: {value: NativeWatchOverlay; presenters: NativeWatchPresenters; common: NativeScreenServices}) {
  const theme = useTheme(), t = defaultI18n.t, [words, setWords] = useState('');
  useEffect(() => {if (value.phase !== 'merge' || value.other) return; const timer = setTimeout(() => {void presenters.search(words);}, 300); return () => clearTimeout(timer);}, [presenters, value.phase, value.other, words]);
  const file = value.owner?.info.files.find(row => row.id === value.fileId), entry = value.capture.entry;
  const heading = value.phase === 'delete' ? t('title.deleteVersion.title') : value.phase === 'split' || value.phase === 'split-pick' ? t('title.split.title') : t(value.other ? 'web.merge.title' : 'title.merge.action');
  const from = value.other && (value.keep === value.other.id ? entry : value.other);
  const retry = () => {if (value.phase === 'delete') void presenters.previewDelete(); else if (value.phase === 'merge') void presenters.search(words); else void presenters.split();};
  const body = <View style={{gap: 16}}>
    {!!value.error && <StateView variant="inline" {...common.error(value.error, retry, 'detail')}/>}
    {value.phase === 'delete' ? <>
      {!value.preview && !value.error && <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('deleteMedia.checking')}</Text>}
      {value.preview && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('title.deleteVersion.body', {size: value.preview.totalBytesText})}</Text>}
      {file?.path && <Text selectable style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{file.path}</Text>}
      {value.preview && (deletionAllowed(value.preview) ? <TextField testID="watch-delete-version-confirmation" label={t(value.preview.confirmationKind === 'count' ? 'deleteMedia.typeCount' : 'deleteMedia.typeTitle', {count: value.preview.confirmation})}
        description={value.preview.confirmationKind === 'title' ? value.preview.confirmation : undefined} value={value.confirmation} onChangeText={presenters.confirmation} editable={!value.busy} autoCapitalize="none" autoCorrect={false}/>
        : <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('deleteMedia.disabled')}</Text>)}
    </> : value.phase === 'split-pick' ? value.owner?.info.groups.flatMap(group => group.members.length === 1 ? group.members : []).filter(row => row.available).map(row => <Button key={row.id} focusId={`watch-split-file-${row.id}`} testID={`watch-split-file-${row.id}`} variant="glass" onPress={() => presenters.chooseSplit(row.id)}>{row.path ?? value.owner?.info.model.files.find(group => group.id === row.id)?.display.heading.text}</Button>)
      : value.phase === 'split' ? <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{named(entry)}{'\n'}{file?.path}{'\n\n'}{t('title.split.body')}</Text>
        : !value.other ? <><TextField testID="watch-merge-search" label={t('title.merge.find')} value={words} onChangeText={setWords} maxLength={200} autoCorrect={false}/>
          {value.candidates.map(other => <Button key={other.id} focusId={`watch-merge-candidate-${other.id}`} testID={`watch-merge-candidate-${other.id}`} variant="glass" onPress={() => presenters.chooseMerge(other)}>{named(other)}</Button>)}
          {value.searchReady && !value.candidates.length && !value.error && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('title.merge.none')}</Text>}</>
          : <><Text style={[theme.type.captionStrong, {color: theme.colors.textSecondary}]}>{t('web.merge.keep')}</Text>{[entry, value.other].map(other => <Button key={other.id} focusId={`watch-merge-keep-${other.id}`} testID={`watch-merge-keep-${other.id}`} variant={value.keep === other.id ? 'primary' : 'glass'} accessibilityState={{selected: value.keep === other.id}} onPress={() => presenters.keep(other.id)} disabled={value.busy}>{named(other)}</Button>)}
            <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t(mergeExplanation(entry.kind), {title: named(from!)})}</Text></>}
  </View>;
  const footer = <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 10}}>
    <Button focusId="watch-manage-cancel" testID="watch-manage-cancel" variant="glass" disabled={value.busy} onPress={presenters.backToInfo}>{t('action.cancel')}</Button>
    {value.phase === 'delete' ? <Button focusId="watch-delete-version" testID="watch-delete-version" variant="primary" disabled={value.busy || !value.preview || !deletionAllowed(value.preview) || value.confirmation.trim() !== value.preview.confirmation} onPress={() => {void presenters.deleteVersion();}}>{t('action.delete')}</Button>
      : value.phase === 'split' ? <Button focusId="watch-split-confirm" testID="watch-split-confirm" disabled={value.busy} onPress={() => {void presenters.split();}}>{t('title.split.confirm')}</Button>
        : value.phase === 'merge' && value.other ? <Button focusId="watch-merge-confirm" testID="watch-merge-confirm" disabled={value.busy} onPress={() => {void presenters.merge();}}>{t('web.selection.merge')}</Button> : null}
  </View>;
  return <Dialog open title={heading} description={named(entry)} onOpenChange={open => {if (!open) presenters.close();}} footer={footer} dismissOnBack={!value.busy} dismissOnOutsidePress={!value.busy} showClose={false} testID="watch-file-manage">
    <ScrollView contentContainerStyle={{paddingHorizontal: theme.isTV ? 0 : 20, paddingVertical: 16}}>{body}</ScrollView>
  </Dialog>;
}

export function NativeWatchOverlays({presenters, runtime, common}: {presenters: NativeWatchPresenters; runtime: NativeShellRuntime; common: NativeScreenServices}) {
  const value = useSyncExternalStore(presenters.subscribe, presenters.getSnapshot), t = defaultI18n.t;
  if (!value || !presenters.current(value.capture)) return null;
  if (value.phase === 'file-info') return <FileInfoSurface value={value} presenters={presenters}/>;
  if (value.phase !== 'menu' && value.phase !== 'file-pending') return <ManageSurface value={value} presenters={presenters} common={common}/>;
  if (value.phase === 'file-pending') return null;
  const entry = value.capture.entry, art = runtime.artwork(entry.posterUrl), subject = named(entry);
  const kindKey = entry.kind === 'movie' ? 'search.kind.movie' : entry.kind === 'show' ? 'search.kind.show' : entry.kind === 'artist' ? 'search.kind.artist' : entry.kind === 'album' ? 'search.kind.album' : undefined;
  const items: MenuEntry[] = [{id: 'file-info', label: t('next.overlays.fileInfo'), icon: 'i-info', onSelect: () => {void presenters.fileInfo(value);}}];
  // Different version is added only by the separately composed genuine
  // destination. This presenter never installs an optimistic command.
  return <Menu open testID="watch-title-menu" title={subject} items={items} touchContext={!Platform.isTV} anchorRef={value.anchorRef}
    touchHeader={<TouchMenuHeader title={subject} artwork={art ? <Artwork source={art} width={40} height={60}/> : undefined} kind={kindKey ? t(kindKey) : undefined} year={entry.year === undefined ? undefined : defaultI18n.number(entry.year, {useGrouping: false})}/>}
    onOpenChange={open => {if (!open) presenters.closeMenu(value);}}/>;
}
