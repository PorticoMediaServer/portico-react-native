import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {generatedCoverTint} from '@portico/design';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ReadingItem} from '../../../../../packages/client-core/src';
import {GeneratedCover} from '../../kit/artwork';
import {PosterCard} from '../../kit/cards';
import {Focusable} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {StateView} from '../../kit/states';
import {browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import {nativeScreenServices} from '../native-screen-services';
import {NativeReadingLibrary} from './reading-library';

export type NativeReadingLibraryScreenProps = Readonly<{
  context: NativeShellBootstrapContext;
  runtime: NativeShellRuntime;
  libraryId: string;
  title: string;
  onBack: () => void;
}>;

/** A reading library's own bounded list: `GET /v1/reading/items`, never the
 * generic content browse (which has no reading hierarchy). */
export function NativeReadingLibraryScreen(props: NativeReadingLibraryScreenProps) {
  const {context, runtime, libraryId, title, onBack} = props, theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  const controller = useMemo(() => new NativeReadingLibrary(context, libraryId), [context, libraryId]);
  const services = useMemo(() => nativeScreenServices(context), [context]);
  useEffect(() => {void controller.load().catch(runtime.reportError); return () => controller.dispose();}, [controller, runtime]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const columns = dimensions.width >= 700 ? 4 : 3, gap = 12, inset = 20;
  const width = Math.max(96, (dimensions.width - inset * 2 - gap * (columns - 1)) / columns);
  const open = (item: ReadingItem) => {void controller.open(item).catch(runtime.reportError);};
  return <View testID={`native-reading-library-${libraryId}`} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View style={{paddingTop: insets.top + 8, paddingHorizontal: inset, paddingBottom: 12, borderBottomWidth: 1, borderColor: theme.colors.line}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
        <Focusable testID="reading-library-back" accessibilityRole="button" accessibilityLabel={defaultI18n.t('action.back')} onPress={onBack} focusRadius={18}
          style={{width: 36, height: 36, alignItems: 'center', justifyContent: 'center'}}><Icon name="i-left" size={22} color={theme.colors.textSecondary}/></Focusable>
        <Text accessibilityRole="header" numberOfLines={1} style={[browseType(theme, 22, 800, -.02), {color: theme.colors.text, flex: 1}]}>{title}</Text>
      </View>
    </View>
    <ScrollView contentContainerStyle={{padding: inset, paddingBottom: insets.bottom + 40}}
      onScroll={event => {const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
        if (contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height) void controller.more().catch(runtime.reportError);}} scrollEventThrottle={64}>
      {state.phase === 'error' ? <StateView variant="inline" {...services.error(state.error, () => {void controller.retry().catch(runtime.reportError);}, 'library')}/> : null}
      {state.phase === 'loading' && state.items.length === 0 ? <Text style={[browseType(theme, 14, 500), {color: theme.colors.textTertiary}]}>{defaultI18n.t('status.loading')}</Text> : null}
      {state.phase === 'ready' && state.items.length === 0 ? <StateView testID="reading-library-empty" variant="inline"
        title={defaultI18n.t('library.emptyLibrary')} body={defaultI18n.t('library.emptyLibraryBody')}/> : null}
      {state.items.length > 0 ? <View style={{flexDirection: 'row', flexWrap: 'wrap', gap, marginBottom: 12}}>
        {state.items.map(item => <PosterCard key={item.id} testID={`reading-item-${item.id}`} title={item.title} width={width}
          artworkFallback={<View accessible={false} importantForAccessibility="no-hide-descendants"><GeneratedCover title={item.title}
            author={item.author?.value} glyph={item.title.trim().slice(0, 1).toUpperCase() || '·'}
            tint={generatedCoverTint(item.title)} width={width} height={width * 1.5}/></View>}
          caption={item.author ? [{id: 'author', text: item.author.value, role: 'context'}] : []} disabled={!item.inventoryAvailable}
          onNavigate={() => open(item)}/>)}
      </View> : null}
    </ScrollView>
  </View>;
}
