import React, {useEffect, useRef, useSyncExternalStore, type RefObject} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {browseToolbarModel} from '../../../../../packages/client-core/src/presentation/kit-model';
import {serverTextLabel} from '../../../../../packages/client-core/src/presentation/server-text';
import {homeEntryCapabilities} from '../../../../../packages/client-core/src/home-selection';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {Button, Chip, Focusable} from '../../kit/controls';
import {FiltersButton, QuickToggle, SortMenu} from '../../kit/browse';
import {PosterCard} from '../../kit/cards';
import {AmbientArt} from '../../kit/artwork';
import {FocusItem, FocusRegion, useFocusRegistry} from '../../kit/focus';
import {WindowedGrid, type LayoutSelection} from '../../kit/layout';
import {Icon} from '../../kit/Icon';
import {SkeletonBlock, StateView} from '../../kit/states';
import {nativeType, useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import {authorityKey} from '../../shell/model';
import {homeBrowseLabel} from './browse-label';
import {homeCardText} from './model';
import {NativeHomeRowController} from './row-controller';

export {homeBrowseLabel};

/** Requested row only. Membership IDs locate grid cells; displayed episodes and
 * their actual playback targets retain their independent server identities. */
export function HomeSeeAll({controller, runtime, active, onBack, onPlay, onOpen, onPlayEntry, onMenu, onFilters, onReshuffle, kindLabel, selection}: {
  controller: NativeHomeRowController; runtime: NativeShellRuntime; active: boolean;
  onBack: () => void; onPlay: (shuffle: boolean) => void; onOpen: (entry: ContentEntry) => void; onPlayEntry: (entry: ContentEntry, current: () => boolean) => void;
  onMenu?: (entry: ContentEntry, anchor: RefObject<View | null>) => void; onFilters: () => void; onReshuffle: () => void;
  kindLabel: (id: string) => string; selection?: LayoutSelection;
}) {
  const theme = useTheme(), registry = useFocusRegistry(), t = runtime.text.t, labels = {t, has: defaultI18n.has};
  const visible = useRef(active); visible.current = active;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const data = useSyncExternalStore(controller.collection.subscribe, controller.collection.getSnapshot);
  const entered = useRef(false), gridId = `home-see-all:${authorityKey(runtime.getSnapshot().authority)}:${controller.rowId}`;
  const focusRevision = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  useEffect(() => {void controller.load();}, [controller]);
  useEffect(() => {
    if (!theme.isTV || !active || entered.current || state.phase !== 'ready' || !registry.child({regionId: gridId, childId: 'play'})) return;
    if (registry.focus({regionId: gridId, childId: 'play'})) entered.current = true;
  }, [active, focusRevision, gridId, registry, state.phase, theme.isTV]);
  if (state.phase === 'error') return <StateView {...runtime.error(state.error, () => {void controller.load();})} variant="centered"/>;
  if (!state.row || !state.capabilities || !state.sort) return <View style={{flex: 1, padding: theme.isTV ? 200 : 20}}><SkeletonBlock width="65%" height={theme.isTV ? 62 : 32}/></View>;
  const row = state.row;
  const model = browseToolbarModel(state.capabilities, 'movies', state.filters, state.sort, {t: runtime.text.t, locale: runtime.text.locale,
    textEntry: !theme.isTV, scope: 'group', owner: runtime.getSnapshot().account.viewerRole === 'owner'});
  const total = state.counts.find(value => value.id === (state.selectedKind ?? 'all'));
  const title = serverTextLabel(labels, row.titleText, row.title);
  const reason = row.reason?.text ?? row.why ?? row.subtitleText;
  const artwork = row.entries.find(entry => entry.backdropUrl || entry.posterUrl);
  const tv = theme.isTV, gutter = tv ? 200 : theme.gutter, cardScale = (runtime.appearanceCardSizePercent ?? 100) / 100,
    width = Math.round((tv ? 200 : theme.spec.card.width.poster[theme.platform]) * cardScale);
  return <View testID="home-see-all" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    {artwork && <View pointerEvents="none" style={{position: 'absolute', inset: 0, opacity: .26}}><AmbientArt source={runtime.ambient(artwork.backdropUrl ?? artwork.posterUrl)} treatment="hero" visible={active}/></View>}
    <FocusRegion id={gridId} entry="play" enabled={active} style={{flex: 1}}>
      <View style={{paddingLeft: gutter, paddingRight: tv ? 96 : theme.gutter, paddingTop: tv ? 64 : 20, paddingBottom: tv ? 24 : 16}}>
        <Focusable focusId="back" onPress={onBack} accessibilityRole="button" accessibilityLabel={t('next.home.shell.home')} style={{height: tv ? 32 : 28, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start'}}>
          <Icon name="i-left" size={tv ? 22 : 16} color={theme.colors.textTertiary}/><Text style={[nativeType({size: tv ? 22 : 14, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary}]}>{t('next.home.shell.home')}</Text>
        </Focusable>
        <Text accessibilityRole="header" style={[nativeType({size: tv ? 62 : 30, weight: 800, tracking: -.04, lineHeight: tv ? 62 : 30}, theme.textScale), {color: theme.colors.text, marginBottom: 12}]}>{title}</Text>
        {reason && <Text style={[nativeType({size: tv ? 24 : 15, weight: 400, tracking: 0, lineHeight: tv ? 34.8 : 22}, theme.textScale), {maxWidth: tv ? 1100 : undefined, color: theme.colors.textSecondary, marginBottom: 24}]}>{serverTextLabel(labels, reason)}</Text>}
        <View style={{flexDirection: 'row', gap: tv ? 16 : 10}}><Button focusId="play" icon="i-play" size={tv ? 'hero' : undefined} onPress={() => onPlay(false)}>{t('entry.play')}</Button>
          <Button focusId="shuffle" variant="glass" icon="i-shuffle" size={tv ? 'hero' : undefined} onPress={() => onPlay(true)}>{t('title.shuffle')}</Button></View>
      </View>
      <View style={{paddingLeft: gutter, paddingRight: tv ? 96 : theme.gutter, flexDirection: 'row', alignItems: 'center', gap: tv ? 14 : 8, paddingBottom: tv ? 34 : 16, flexWrap: tv ? undefined : 'wrap'}}>
        <SortMenu sorts={model.sorts} value={model.sort} label={value => homeBrowseLabel(value, labels)} onValueChange={controller.setSort}
          onReshuffle={onReshuffle}/>
        <FiltersButton count={state.filters.length} onPress={onFilters}/>
        <View style={{width: 1, height: tv ? 40 : 24, backgroundColor: theme.colors.line, marginHorizontal: 6}}/>
        <Chip selected={!state.selectedKind} onPress={() => controller.selectKind(undefined)} count={state.counts.find(value => value.id === 'all')?.total}>{t('search.chip.all')}</Chip>
        {controller.kinds.map(kind => <Chip key={kind.id} selected={state.selectedKind === kind.id} onPress={() => controller.selectKind(kind.id)} count={state.counts.find(value => value.id === kind.id)?.total}>{kindLabel(kind.id)}</Chip>)}
        <View style={{width: 1, height: tv ? 40 : 24, backgroundColor: theme.colors.line, marginHorizontal: 6}}/>
        {model.quick.filter(quick => ['unwatched', 'in-progress'].includes(quick.id)).map(quick => <QuickToggle key={quick.id} checked={quick.active} onCheckedChange={checked => {
          const remaining = state.filters.filter(node => JSON.stringify(node) !== JSON.stringify(quick.query)); controller.setFilters(checked ? [...remaining, quick.query] : remaining);
        }}>{quick.label?.text ?? homeBrowseLabel(quick, labels)}</QuickToggle>)}
        {total && <Text style={[theme.type.caption, {marginLeft: 'auto', color: theme.colors.textTertiary}]}>{t('count.titles', {count: total.total})}</Text>}
      </View>
      {data.error ? <StateView {...runtime.error(data.error, () => controller.collection.ensureRange(0, 0))} variant="centered"/> :
        <WindowedGrid collection={controller.collection} getKey={item => item.membershipId} selection={selection} itemWidth={width} itemHeight={width * 1.5 + (tv ? 74 : 48)}
          gap={tv ? 32 : 12} rowGap={tv ? 40 : 22} gutter={gutter} rightGutter={tv ? 96 : theme.gutter} paddingBottom={40} style={{flex: 1}} testID="home-see-all-grid"
          renderPlaceholder={index => <SkeletonBlock key={index} width={width} height={width * 1.5}/>}
          renderItem={(item, cell) => <FocusItem focusId={item.membershipId}><HomeRowCard entry={item.entry} runtime={runtime} width={width} onFocus={cell.onFocus} onBlur={cell.onBlur}
            onOpen={() => {if (controller.isCurrentItem(item, cell.index)) onOpen(item.entry);}} onPlay={() => {
              const current = () => visible.current && controller.isCurrentItem(item, cell.index);
              if (current()) onPlayEntry(item.entry, current);
            }}
            onMenu={onMenu ? anchor => {if (controller.isCurrentItem(item, cell.index)) onMenu(item.entry, anchor);} : undefined}/></FocusItem>}/>
      }
    </FocusRegion>
  </View>;
}

function HomeRowCard({entry, runtime, width, onOpen, onPlay, onMenu, onFocus, onBlur}: {entry: ContentEntry; runtime: NativeShellRuntime; width: number; onOpen: () => void; onPlay: () => void;
  onMenu?: (anchor: RefObject<View | null>) => void; onFocus: () => void; onBlur: () => void}) {
  const anchor = useRef<View>(null), theme = useTheme(), text = homeCardText(entry, false, runtime.text);
  const allowed = homeEntryCapabilities(entry, {platform: theme.isTV ? 'tv' : 'phone-app', playbackAvailable: !!runtime.playback});
  return <PosterCard title={text.title} caption={text.caption} detail={text.detail} width={width} artwork={runtime.artwork(entry.posterUrl)} density="grid" menuAnchorRef={anchor}
    onNavigate={onOpen} primaryAction={theme.isTV && allowed.playable && entry.playback ? 'play' : 'navigate'} onPlay={onPlay} onFocus={onFocus} onBlur={onBlur} onMore={onMenu ? () => onMenu(anchor) : undefined}/>;
}
