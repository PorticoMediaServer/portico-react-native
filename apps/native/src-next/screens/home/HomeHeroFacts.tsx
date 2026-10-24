import React from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {CardTextModel, FactPart} from '../../../../../packages/client-core/src/presentation/kit-model';
import {useTheme} from '../../kit/theme';
import {homeFactStrong, homeFactTag} from './native-home-r46';

/** The display context stays canonical; continuation timing is a separate genuine projection. */
export function HomeHeroFacts({facts, continuation}: {facts: readonly FactPart[]; continuation?: CardTextModel}) {
  const theme = useTheme();
  const remaining = continuation?.detail.find(part => part.id === 'remaining');
  return <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: theme.layoutMode === 'phone' ? 'center' : 'flex-start', columnGap: theme.spec.hero.facts.gap[theme.platform], rowGap: theme.spec.hero.facts.rowGap[theme.platform]}}>
    {facts.map(fact => {
      const badge = fact.id === 'duration' || fact.id === 'season-count';
      const text = <Text style={[badge ? theme.type.tag : theme.type.meta, {includeFontPadding: false, color: badge || fact.id === 'year' ? theme.colors.text : theme.colors.textSecondary, ...(!badge && fact.id === 'year' ? {fontFamily: homeFactStrong(theme)} : {})}]}>{fact.text}</Text>;
      return badge ? <View key={fact.id} style={homeFactTag(theme)}>{text}</View> : <React.Fragment key={fact.id}>{text}</React.Fragment>;
    })}
    {theme.isTV && continuation?.progress !== undefined && remaining && <View style={{flexDirection: 'row', alignItems: 'center', gap: 14}}>
      <View accessible={false} style={{width: 160, height: 6, borderRadius: 6, overflow: 'hidden', backgroundColor: `${theme.colors.text}38`}}><View style={{width: `${continuation.progress * 100}%`, height: '100%', backgroundColor: theme.colors.accentStrong}}/></View>
      <Text style={[theme.type.meta, {includeFontPadding: false, color: theme.colors.text, fontFamily: theme.type.bodyStrong.fontFamily}]}>{remaining.text}</Text>
    </View>}
  </View>;
}

export function HomeRemoteHint({resume}: {resume: boolean}) {
  const theme = useTheme();
  const key = (label: string) => <View style={{height: 36, minWidth: 44, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1.5, borderColor: `${theme.colors.text}4D`, alignItems: 'center', justifyContent: 'center'}}><Text style={[theme.type.badge, {includeFontPadding: false, color: theme.colors.textSecondary}]}>{label}</Text></View>;
  return <View style={{flexDirection: 'row', alignItems: 'center', columnGap: 68}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>{key(defaultI18n.t('next.layout.ok'))}<Text style={[theme.type.captionStrong, {includeFontPadding: false, color: theme.colors.textTertiary}]}>{defaultI18n.t(resume ? 'next.home.resume' : 'next.home.play')}</Text></View>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>{key(defaultI18n.t('next.layout.holdOk'))}<Text style={[theme.type.captionStrong, {includeFontPadding: false, color: theme.colors.textTertiary}]}>{defaultI18n.t('next.layout.moreOptions')}</Text></View>
  </View>;
}
