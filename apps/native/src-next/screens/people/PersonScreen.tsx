import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, VirtualizedList, useWindowDimensions, type ViewToken} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {WindowedCollection} from '../../../../../packages/client-core/src/collections/windowed';
import type {PersonCredit, PersonPage, PersonRole} from '../../../../../packages/client-core/src/people';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {PersonCircle} from '../../kit/artwork';
import {PosterCard} from '../../kit/cards';
import {Chip, Focusable} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {StateView} from '../../kit/states';
import {browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {createNativeEntryActions} from '../destinations/entry-actions';

export type NativePersonScreenProps = Readonly<{
  page: PersonPage; role: PersonRole; collection: WindowedCollection<PersonCredit>;
  runtime: NativeShellRuntime; actions: ReturnType<typeof createNativeEntryActions>;
  onRole: (role: PersonRole) => void; onBack: () => void;
}>;
const t = defaultI18n.t;

/** phone-detail frame7: one sparse credits scroller, with the genuine person,
 * biography and bounded known-for shelf as its header. */
export function PersonScreen({page, role, collection, runtime, actions, onRole, onBack}: NativePersonScreenProps) {
  const theme = useTheme(), dimensions = useWindowDimensions(), insets = useSafeAreaInsets();
  const columns = theme.platform === 'phone' ? 3 : Math.max(3, Math.floor((dimensions.width - 40) / 150));
  const width = (dimensions.width - 32 - (columns - 1) * 10) / columns;
  const [range, setRange] = useState({first: 0, last: columns * 4 - 1});
  const [expanded, setExpanded] = useState(false);
  const firstPage = collection.pageOf(range.first), lastPage = collection.pageOf(range.last);
  const subscribePages = useCallback((listener: () => void) => {
    const stops = [collection.subscribe(listener)];
    for (let index = firstPage; index <= lastPage; index++) stops.push(collection.subscribePage(index, listener));
    return () => stops.forEach(stop => stop());
  }, [collection, firstPage, lastPage]);
  const version = useCallback(() => {
    const state = collection.getSnapshot();
    const values = [`${state.generation}:${state.total}:${state.status}:${state.refreshing}`];
    for (let index = firstPage; index <= lastPage; index++) values.push(collection.getPageVersion(index));
    return values.join('|');
  }, [collection, firstPage, lastPage]);
  useSyncExternalStore(subscribePages, version);
  const state = collection.getSnapshot();
  useEffect(() => {collection.ensureRange(range.first, range.last);}, [collection, range]);
  const columnsRef = useRef(columns); columnsRef.current = columns;
  const visible = useRef(({viewableItems}: {viewableItems: ViewToken<number>[]}) => {
    const indices = viewableItems.flatMap(item => item.index === null ? [] : [item.index]);
    if (!indices.length) return;
    setRange({first: Math.min(...indices) * columnsRef.current, last: (Math.max(...indices) + 1) * columnsRef.current - 1});
  }).current;
  const person = page.person, born = person.birthDate ? defaultI18n.date(person.birthDate, 'long') : undefined;
  const died = person.deathDate ? defaultI18n.date(person.deathDate, 'long') : undefined;
  const dates = born && died ? t('web.person.lived', {born, died}) : born ? t('web.person.born', {date: born}) : undefined;
  const initials = person.name.split(/\s+/u).filter(Boolean).slice(0, 2).map(word => [...word][0]).join('');
  const known = page.person.knownFor;
  const header = <>
    <View style={{paddingTop: Math.max(98, insets.top + 44), paddingHorizontal: 20, alignItems: 'center'}}>
      <PersonCircle size={96} initials={initials} source={runtime.artwork(person.portraitUrl)} covers={known.flatMap(entry => {const art = runtime.artwork(entry.posterUrl); return art ? [art] : [];})}/>
      <Text accessibilityRole="header" style={[browseType(theme, 30, 800, -.035), {color: theme.colors.text, marginTop: 12, marginBottom: 4}]}>{person.name}</Text>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 12, rowGap: 6}}>
        {!!person.roles.length && <Text style={[browseType(theme, 13, 600), {color: theme.colors.textSecondary}]}>{new Intl.ListFormat(runtime.text.locale, {type: 'conjunction'}).format(person.roles)}</Text>}
        {dates && <Text style={[browseType(theme, 13, 400), {color: theme.colors.textSecondary}]}>{dates}</Text>}
      </View>
    </View>
    {!!person.biography && <View style={{marginTop: 12, marginHorizontal: 20}}>
      <Text numberOfLines={expanded ? undefined : 2} style={[browseType(theme, 14, 400), {lineHeight: 21, color: theme.colors.textSecondary}]}>{person.biography}</Text>
      <Focusable testID="person-biography-expand" onPress={() => setExpanded(value => !value)} accessibilityRole="button" accessibilityState={{expanded}}>
        <Text style={[browseType(theme, 14, 700), {color: theme.colors.text}]}>{t(expanded ? 'web.person.showLess' : 'web.person.readMore')}</Text>
      </Focusable>
    </View>}
    {!!known.length && <View style={{marginTop: 16}}>
      <Text accessibilityRole="header" style={[browseType(theme, 19, 800), {color: theme.colors.text, marginHorizontal: 20, marginBottom: 14}]}>{t('web.person.knownFor')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 4, gap: 12}}>
        {known.map(entry => <PosterCard key={`${entry.kind}:${entry.id}`} testID={`person-known-${entry.id}`} title={entry.displayTitle || entry.title} width={96} artwork={runtime.artwork(entry.posterUrl)}
          caption={entry.year === undefined ? [] : [{id: 'year', text: String(entry.year), role: 'context'}]} onNavigate={() => actions.open(entry)}/>)}
      </ScrollView>
    </View>}
    <View style={{flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12, marginHorizontal: 20, marginBottom: 10}}>
      <Text accessibilityRole="header" style={[browseType(theme, 18, 700, -.015), {color: theme.colors.text}]}>{t('web.person.credits')}</Text>
      <Text style={[browseType(theme, 14, 600), {color: theme.colors.textTertiary}]}>{t('web.person.titles', {count: page.pageInfo.total})}</Text>
    </View>
    <View style={{flexDirection: 'row', gap: 8, marginHorizontal: 20, marginBottom: 12}}>
      {(['all', 'cast', 'crew'] as const).map(value => <Chip key={value} testID={`person-role-${value}`} selected={role === value} onPress={() => onRole(value)}>{t(value === 'all' ? 'title.creditsAll' : value === 'cast' ? 'web.person.cast' : 'web.person.crew')}</Chip>)}
    </View>
  </>;
  const rows = useMemo(() => Math.ceil((state.total ?? page.pageInfo.total) / columns), [columns, page.pageInfo.total, state.total]);
  return <View style={{flex: 1, backgroundColor: theme.colors.ink}} testID="native-person">
    <VirtualizedList data={collection} getItem={(_data, index) => index} getItemCount={() => rows} keyExtractor={index => String(index)} extraData={version()}
      initialNumToRender={4} maxToRenderPerBatch={4} windowSize={5} ListHeaderComponent={header} onViewableItemsChanged={visible}
      contentContainerStyle={{paddingBottom: insets.bottom + 24}} renderItem={({item: row}: {item: number}) => <View style={{flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 16}}>
        {Array.from({length: columns}, (_, column) => {
          const index = row * columns + column;
          if (index >= (state.total ?? page.pageInfo.total)) return null;
          const credit = collection.itemAt(index), entry = credit?.media;
          return entry && credit ? <PosterCard key={index} testID={`person-credit-${index}`} density="grid" title={entry.displayTitle || entry.title} width={width} artwork={runtime.artwork(entry.posterUrl)}
            caption={credit.character ? [{id: 'character', text: t('web.person.as', {character: credit.character}), role: 'context'}] : credit.role ? [{id: 'role', text: credit.role, role: 'context'}] : []}
            onNavigate={() => actions.open(entry)}/> : <View key={index} testID={`person-credit-placeholder-${index}`} style={{width, height: width * 1.5 + 44, borderRadius: 10, backgroundColor: theme.colors.raised}}/>;
        })}
      </View>}
      ListEmptyComponent={<StateView title={t('web.person.noCredits')} body={t(role === 'cast' ? 'web.person.noCast' : role === 'crew' ? 'web.person.noCrew' : 'web.person.noCreditsBody')}/>}
      ListFooterComponent={state.status === 'error' ? <StateView {...runtime.error(state.error, () => collection.retry())}/> : null}/>
    <Focusable testID="person-back" accessibilityLabel={t('action.back')} onPress={onBack} focusRadius={20}
      style={{position: 'absolute', left: 16, top: insets.top + 12, width: 40, height: 40, alignItems: 'center', justifyContent: 'center'}}><Icon name="i-left" size={22} color={theme.colors.text}/></Focusable>
  </View>;
}
