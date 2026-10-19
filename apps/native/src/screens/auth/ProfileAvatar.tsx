import React, {useEffect, useMemo, useState} from 'react';
import {Image, View, type ImageSourcePropType} from 'react-native';
import {IdentityClient, type HttpLocalApi, type ProfileAvatar as AvatarRecord} from '../../../../../packages/client-core/src/index';
import {profileArtColors} from '../../../../../packages/design/src/index';
import {Text, useTheme} from '../../ui';
import {profilePictureSource, useAvatarRoute} from '../../bridge/profile-avatars';

type Art = keyof typeof profileArtColors;
const isArt = (value: unknown): value is Art => typeof value === 'string' && value in profileArtColors;

/**
 * APL-SYS-10: a profile's face. The picture the profile uploaded when there is one, otherwise
 * its initial on the profile's own colour (the art every client shares), so a household tells
 * its profiles apart at a glance. The picture fades in over the initial and never leaves a hole.
 */
export function ProfileAvatar({name, art, source, size, focused, dimmed}: {name: string; art?: string; source?: ImageSourcePropType; size: number; focused?: boolean; dimmed?: boolean}) {
  const {colors, isTV} = useTheme();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return (
    <View style={{width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: isArt(art) ? profileArtColors[art] : colors.raisedHigh, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: focused ? colors.focus : 'transparent', opacity: dimmed ? 0.5 : 1}}>
      <Text variant={isTV ? 'title' : 'heading'}>{name.slice(0, 1).toUpperCase()}</Text>
      {source && !failed ? <Image source={source} onError={() => setFailed(true)} accessibilityIgnoresInvertColors style={{position: 'absolute', top: 0, left: 0, width: size, height: size}} resizeMode="cover" /> : null}
    </View>
  );
}

/**
 * The uploaded pictures of a direct account's profiles, as image sources by profile id. Needs a
 * token the server accepts for the account (the account grant while choosing, or the profile
 * session when switching); without one the chooser shows initials.
 */
export function useProfilePictures(api: HttpLocalApi | undefined, token: string | undefined, size: number): ReadonlyMap<string, ImageSourcePropType> {
  const route = useAvatarRoute(api);
  const [pictures, setPictures] = useState<{api: HttpLocalApi; avatars: readonly AvatarRecord[]}>();
  useEffect(() => {
    if (!api || !token) return;
    let live = true;
    const abort = new AbortController();
    new IdentityClient(api).avatars(abort.signal).then(list => { if (live) setPictures({api, avatars: list}); }, () => {});
    return () => { live = false; abort.abort(); };
  }, [api, token]);
  return useMemo(() => {
    const out = new Map<string, ImageSourcePropType>();
    if (!api || !token || pictures?.api !== api || (route && route.phase !== 'ready')) return out;
    const pixels = Math.round(size * 2);
    for (const a of pictures.avatars) {
      const source = profilePictureSource(api, token, a, pixels);
      if (source) out.set(a.profileId, source);
    }
    return out;
  }, [pictures, token, api, size, route]);
}
