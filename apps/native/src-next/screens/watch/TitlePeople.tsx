import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import type {DetailCredit} from '../../../../../packages/client-core/src/detail';
import {PersonCircle, type ArtworkSource} from '../../kit/artwork';
import {TVShelf, tvItemKey} from '../../tv/layout/TVShelf';
import {Focusable} from '../../kit/controls';
import {fontFamilies, useTheme} from '../../kit/theme';

export type TitlePeopleProps = Readonly<{
  credits: readonly DetailCredit[];
  artwork: (path: string | undefined) => ArtworkSource | undefined;
  /** Absent where the shell has no registered person route; the row stays information. */
  onPerson?: (personId: string) => void;
}>;

const initials = (name: string) => name.split(/\s+/u).filter(Boolean).slice(0, 2).map(word => [...word][0]).join('');

/** phone-detail frame 2: the Cast & crew row. The demo has no portraits, so
 * the drawn circle is the shared initials fallback; a real portrait wins. */
export function TitlePeople({credits, artwork, onPerson}: TitlePeopleProps) {
  const theme = useTheme();
  const render = (credit: DetailCredit, onFocus?: () => void, onBlur?: () => void) => {
      const face = <View accessibilityLabel={[credit.name, credit.role].filter(Boolean).join(', ')}
        style={{width: 78, alignItems: 'center'}}>
        <PersonCircle size={64} initials={initials(credit.name)} source={artwork(credit.portraitUrl)} covers={[]} alt={credit.name}/>
        <Text numberOfLines={2} style={{fontFamily: fontFamilies[700], fontSize: 12.5, fontWeight: '700', lineHeight: 15.6, marginTop: 7, textAlign: 'center', color: theme.colors.text}}>{credit.name}</Text>
        {credit.role ? <Text numberOfLines={1} style={{fontFamily: fontFamilies[400], fontSize: 11.5, lineHeight: 14.4, marginTop: 2, textAlign: 'center', color: theme.colors.textTertiary}}>{credit.role}</Text> : null}
      </View>;
      const open = onPerson && credit.personId;
      return open ? <Focusable key={credit.id} testID={`watch-person-${credit.id}`} focusKind="card" focusRadius={78 / 2}
        accessibilityRole="button" accessibilityLabel={credit.name} onPress={() => onPerson!(credit.personId!)} onFocus={onFocus} onBlur={onBlur}>{face}</Focusable>
        : <View key={credit.id}>{face}</View>;
  };
  return theme.isTV ? <TVShelf items={credits} getKey={tvItemKey} itemWidth={78} itemHeight={125} gap={12} renderItem={(credit, slot) => render(credit, slot.onFocus, slot.onBlur)}/>
    : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 12, alignItems: 'flex-start'}}>{credits.map(credit => render(credit))}</ScrollView>;
}
