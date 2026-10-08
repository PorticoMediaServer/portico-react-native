import React from 'react';
import {View} from 'react-native';
import {isTablet} from '../bridge/device-platform';
import {Atmosphere, useTheme} from '../ui';
import {BottomBar} from './BottomBar';
import {Rail} from './Rail';

/**
 * The shell's own frame (atmosphere, the rail on TV and iPad, the tab bar on iPhone) around
 * content that is centered like the shell's empty states. A Portico Account lands here straight
 * after signing in, while its server opens, or when one must be chosen or failed (Justin: never a
 * separate "Choose a server" screen). Destinations open once a server is open.
 */
export function ShellFrame({children, profileName, serverName}: {children: React.ReactNode; profileName?: string; serverName?: string}) {
  const {colors, isTV, window, space} = useTheme();
  const handheld = !isTV && (!isTablet || window.width < 700);
  const none = () => {};
  return (
    <View style={{flex: 1, backgroundColor: colors.ink}}>
      <Atmosphere />
      <View style={{flex: 1, flexDirection: handheld ? 'column' : 'row'}}>
        {handheld ? null : (
          <View style={{alignSelf: 'stretch', zIndex: 20}}>
            <Rail libraries={[]} selected="Home" onSelect={none} profileName={profileName} serverName={serverName} showChannels={false} />
          </View>
        )}
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.page}}>
          <View style={{width: '100%', maxWidth: isTV ? 900 : 560}}>{children}</View>
        </View>
      </View>
      {handheld ? <BottomBar selected="Home" onSelect={none} showChannels={false} showDownloads={false} /> : null}
    </View>
  );
}
