import React from 'react';
import {View} from 'react-native';
import {unavailableMessage} from '../../../../../packages/client-core/src/channel-guide';
import type {GuideChannelRow} from '../../../../../packages/client-core/src/guide/index';
import {profileArtColors} from '../../../../../packages/design/src/index';
import {useArtwork} from '../../app/content';
import {defaultI18n} from '../../../../../packages/i18n/src/index';
import {Artwork, Icon, Text, alpha, useTheme} from '../../ui';
import {initials, tintIndex} from './format';

const tints = Object.values(profileArtColors);

/**
 * Why a channel can't be watched, in viewer language (catalogue text), or ''. `quiet`: the whole
 * server can't play channels and the screen says so once (FEAT-01), so rows don't repeat it.
 */
export const channelReason = (channel: GuideChannelRow, quiet = false): string => (channel.tuneAvailable || quiet ? '' : unavailableMessage((channel.tuneUnavailableReason ?? '') as never));
/** Rows of channels that can't be watched are dimmed, unless the reason is the server's (FEAT-01). */
export const channelDimmed = (channel: GuideChannelRow, quiet = false): boolean => !channel.tuneAvailable && !quiet;

/** §2.1: the source logo letterboxed on a raised tile, or initials on a tint stable for the channel. Never a broken image. */
export const ChannelLogo = React.memo(function ChannelLogo({channel, size}: {channel: GuideChannelRow; size: number}) {
  const artwork = useArtwork();
  const {colors, metrics} = useTheme();
  if (channel.logoUrl) {
    return (
      <View style={{width: size, height: size, borderRadius: metrics.radius.small, backgroundColor: colors.raisedHigh, overflow: 'hidden', alignItems: 'center', justifyContent: 'center'}}>
        <Artwork source={artwork(channel.logoUrl)} shape="square" width={size} height={size} radius={metrics.radius.small} title={channel.name} />
      </View>
    );
  }
  return (
    <View accessible={false} style={{width: size, height: size, borderRadius: metrics.radius.small, backgroundColor: tints[tintIndex(channel.id, tints.length)], alignItems: 'center', justifyContent: 'center'}}>
      <Text variant={size >= 64 ? 'subheading' : 'captionStrong'} style={{color: colors.white}}>{initials(channel.name)}</Text>
    </View>
  );
});

/** §2.0a: the Library Channels badge (its glyph until `libraryChannel` is drawn). The name is one catalogue ID. */
export function LibraryMark({size}: {size?: number}) {
  const {colors, metrics, isTV} = useTheme();
  const s = size ?? (isTV ? 22 : 14);
  return (
    <View accessibilityRole="image" accessibilityLabel={defaultI18n.t('channels.custom.name')} style={{width: s + 8, height: s + 4, borderRadius: metrics.radius.small, backgroundColor: alpha(colors.accent, 0.22), alignItems: 'center', justifyContent: 'center'}}>
      <Icon name="library" size={s} color={colors.accent} />
    </View>
  );
}

/** The channel's name line: name, favorite star and the Library Channels mark. */
export function ChannelName({channel, variant, prefix}: {channel: GuideChannelRow; variant: 'bodyStrong' | 'body' | 'captionStrong' | 'subheading'; prefix?: string}) {
  const {colors, space, isTV} = useTheme();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: space.xs, minWidth: 0}}>
      <Text variant={variant} lines={1} style={{flexShrink: 1}}>{prefix ? `${prefix} ${channel.name}` : channel.name}</Text>
      {channel.favorite ? <Icon name="starFilled" size={isTV ? 22 : 14} color={colors.amber} /> : null}
      {channel.kind === 'library' ? <LibraryMark /> : null}
    </View>
  );
}

/** The accessibility name of a row header: number and name, then why it can't be watched. */
export function channelA11y(channel: GuideChannelRow, quiet = false): string {
  return [channel.number ? defaultI18n.t('channels.channel', {number: channel.number}) : '', channel.name, channelReason(channel, quiet)].filter(Boolean).join(', ');
}
