import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {useTheme} from '../../../kit/theme';
import {browseType} from '../../../kit/browse/presentation';
import type {NativeShellBootstrapContext} from '../../../shell/bootstrap';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../../shell/route-registry';
import {MusicMixesRow} from './MusicMixesRow';

const t = defaultI18n.t;

/** music-plus 18/21: the TV Music Discover page. It draws the profile's own Mixes row
 * from the server projection; there is no second row store and no invented shelf. */
function MusicDiscoverPage({runtime}: {runtime: Parameters<NativeRouteRenderer['render']>[1]}) {
  const theme = useTheme(), tv = theme.isTV;
  return <View testID="music-discover" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ScrollView contentContainerStyle={{paddingTop: tv ? 96 : 24, paddingBottom: 64}} showsVerticalScrollIndicator={false}>
      <Text accessibilityRole="header" style={[browseType(theme, tv ? 48 : 30, 800, -.03), {marginHorizontal: tv ? 96 : 16, color: theme.colors.text}]}>{t('settings.page.music')}</Text>
      {runtime.mixes ? <MusicMixesRow port={runtime.mixes} artwork={runtime.artwork} reportError={runtime.reportError}
        title={t('music.mixesForYou')} marginHorizontal={tv ? 96 : 16}/> : null}
    </ScrollView>
  </View>;
}

/** Registered like the other destination routes: one renderer, disposed with the module. */
export function createNativeMusicDiscoverRenderer(_context: NativeShellBootstrapContext): NativeRouteRenderer {
  let disposed = false;
  return Object.freeze({
    render: (route, runtime) => !disposed && route.kind === 'music-discover' ? <MusicDiscoverPage runtime={runtime}/> : null,
    dispose: () => {disposed = true;},
  });
}

nativeShellRoutes.registerRoute('music-discover', createNativeMusicDiscoverRenderer);
