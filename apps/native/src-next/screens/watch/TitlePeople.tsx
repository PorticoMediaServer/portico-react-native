import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import type {DetailCredit} from '../../../../../packages/client-core/src/detail';
import {Artwork, PersonCircle, type ArtworkSource} from '../../kit/artwork';
import {TVShelf, tvItemKey} from '../../tv/layout/TVShelf';
import {TVArtFocus} from '../../tv/layout/TVArtFocus';
import {Focusable} from '../../kit/controls';
import type {RowProps} from '../../kit/layout/Row';
import {fontFamilies, nativeType, useTheme} from '../../kit/theme';

export type TitlePeopleProps = Readonly<{
  credits: readonly DetailCredit[];
  focus?: RowProps<DetailCredit>['focus'];
  artwork: (path: string | undefined) => ArtworkSource | undefined;
  /** Absent where the shell has no registered person route; the row stays information. */
  onPerson?: (personId: string) => void;
}>;

const initials = (name: string) => name.split(/\s+/u).filter(Boolean).slice(0, 2).map(word => [...word][0]).join('');

/** phone-detail frame 2: the Cast & crew row. The demo has no portraits, so
 * the drawn circle is the shared initials fallback; a real portrait wins. */
export function TitlePeople({credits, artwork, onPerson, focus}: TitlePeopleProps) {
  const theme = useTheme();
  if (theme.isTV) return <TVShelf focus={focus} items={credits} getKey={tvItemKey} itemWidth={200} itemHeight={167 + 80 * theme.textScale} gap={18} renderItem={(credit, slot) => {
    const portrait = artwork(credit.portraitUrl);
    const content = (focused: boolean) => <TVArtFocus focused={focused} width={200} faceSize={150} face={<View style={{width: 150, height: 150, borderRadius: 75, overflow: 'hidden'}}>
      <PersonCircle size={150} initials="" covers={[]} alt={credit.name}/>
      <Text accessible={false} style={{position: 'absolute', width: 150, height: 150, textAlign: 'center', textAlignVertical: 'center', lineHeight: 150,
        fontFamily: fontFamilies[800], fontSize: 44 * theme.textScale, letterSpacing: -.88 * theme.textScale, color: focused ? theme.colors.text : theme.colors.textSecondary}}>{initials(credit.name)}</Text>
      {portrait && <Artwork source={portrait} width={150} height={150} fallback={null} style={{position: 'absolute', inset: 0}}/>}
    </View>}>
      <Text numberOfLines={2} style={[nativeType({size: 21, weight: 700, lineHeight: 26.25, tracking: 0}, theme.textScale),
        {marginTop: 14, textAlign: 'center', color: focused ? theme.colors.text : theme.colors.textSecondary}]}>{credit.name}</Text>
      {credit.role ? <Text numberOfLines={1} style={[nativeType({size: 19, weight: 400, lineHeight: 'normal', tracking: 0}, theme.textScale),
        {marginTop: 3, textAlign: 'center', color: theme.colors.textTertiary}]}>{credit.role}</Text> : null}
    </TVArtFocus>;
    return onPerson && credit.personId ? <Focusable testID={`watch-person-${credit.id}`} focusKind="card" focusTreatment="none" accessibilityRole="button"
      accessibilityLabel={[credit.name, credit.role].filter(Boolean).join(', ')} onPress={() => onPerson(credit.personId!)} onFocus={slot.onFocus} onBlur={slot.onBlur}>
      {({focused}) => content(focused)}
    </Focusable> : content(false);
  }}/>;
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
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 12, alignItems: 'flex-start'}}>{credits.map(credit => render(credit))}</ScrollView>;
}
