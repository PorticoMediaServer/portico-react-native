import React, {useEffect, useMemo, useState} from 'react';
import {Linking, View} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {licenceCount, licenceDetail, licenceParagraphs, licenceRowDetail, licenceSections, licenceSourceRows, type LicenceData, type LicenceSection} from '../../../../packages/client-core/src/presentation/index';
import type {ContentStackParams} from '../app/routes';
import {useI18n} from '../app/i18n';
import {loadLicences, licenceVariant} from '../licences/load';
import {Focusable, ListRow, PageHeader, PageList, RowGroup, StateView, Text, isTV, showToast, useEntryFocus, useTheme} from '../ui';

/**
 * Settings › About › Open-source licenses. The list is generated (`apps/native/scripts/licences.mts`)
 * per platform and is large, so it is read only once this screen has appeared, never at start.
 * Both screens are lists that mount only what is near the viewport, so a remote moves through
 * hundreds of rows and long licence texts (paragraph by paragraph) without waiting.
 */
function useLicences(): LicenceData | null | undefined {
  const [data, setData] = useState<LicenceData | null>();
  useEffect(() => {
    // After the first frame: the screen and its back button are there before the list is read.
    const timer = setTimeout(() => setData(loadLicences() ?? null), 0);
    return () => clearTimeout(timer);
  }, []);
  return data;
}

function openLink(url: string, failed: string) {
  Linking.openURL(url).catch(() => showToast({message: failed, icon: 'warning'}));
}

type ListItem = {key: string; kind: 'intro'} | {key: string; kind: 'sources'} | {key: string; kind: 'count'} | {key: string; kind: 'section'; section: LicenceSection};

export function LicencesScreen() {
  const i18n = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const {space} = useTheme();
  const data = useLicences();
  const entry = useEntryFocus(!!data);
  const variant = licenceVariant();
  const sections = useMemo(() => (data ? licenceSections(data, variant) : []), [data, variant]);
  const header = <PageHeader title={i18n.t('licenses.title')} onBack={() => navigation.goBack()} />;
  if (!data) {
    return (
      <View style={{flex: 1}}>
        {header}
        <View style={{paddingHorizontal: space.page}}>
          {data === undefined ? <StateView loading title={i18n.t('licenses.loading')} /> : <StateView icon="error" title={i18n.t('licenses.unavailable')} />}
        </View>
      </View>
    );
  }
  const items: ListItem[] = [{key: 'intro', kind: 'intro'}, {key: 'sources', kind: 'sources'}, {key: 'count', kind: 'count'}, ...sections.filter(s => s.group !== 'portico').map(section => ({key: section.group, kind: 'section' as const, section}))];
  const portico = sections.find(s => s.group === 'portico')?.components[0];
  const open = (id: string) => navigation.push('Licence', {id});
  const render = ({item}: {item: ListItem}) => {
    switch (item.kind) {
      case 'intro':
        return (
          <RowGroup title={i18n.t('licenses.section.portico')} footer={i18n.t('licenses.portico.body')}>
            {portico ? <ListRow hasTVPreferredFocus={isTV && entry} title={portico.name} subtitle={portico.licence} accessory="navigation" onPress={() => open(portico.id)} /> : null}
          </RowGroup>
        );
      case 'sources':
        return (
          <RowGroup title={i18n.t('licenses.source.title')}>
            {licenceSourceRows(data).map(row => isTV
              ? <ListRow key={row.id} readable title={i18n.t(row.label)} subtitle={row.url} subtitleLines={2} />
              : <ListRow key={row.id} icon="globe" title={i18n.t(row.label)} subtitle={row.url} subtitleLines={2} trailingIcon="external" onPress={() => openLink(row.url, i18n.t('link.openFailed', {address: row.url}))} />)}
          </RowGroup>
        );
      case 'count':
        return <Text variant="caption" tone="tertiary">{i18n.t('licenses.count', {count: licenceCount(data, variant)})}</Text>;
      case 'section':
        return (
          <RowGroup title={i18n.t(item.section.title)}>
            {item.section.components.map(c => <ListRow key={c.id} title={c.name} subtitle={licenceRowDetail(c)} accessory="navigation" onPress={() => open(c.id)} />)}
          </RowGroup>
        );
    }
  };
  return (
    <View style={{flex: 1}}>
      <PageList
        data={items}
        keyExtractor={item => item.key}
        renderItem={render}
        ListHeaderComponent={header}
        contentStyle={{gap: space.xl}}
        ItemSeparatorComponent={() => <View style={{height: space.xl}} />}
        style={{paddingHorizontal: space.page}}
      />
    </View>
  );
}

/** One block of licence text. On television each block takes focus in turn, so the remote scrolls the text. */
function Paragraph({text, mono}: {text: string; mono: boolean}) {
  const {colors, space, metrics} = useTheme();
  const body = (focused: boolean) => (
    <View style={{paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: metrics.radius.control, backgroundColor: focused ? colors.raisedHigh : 'transparent'}}>
      <Text variant="caption" tone="secondary" style={mono ? {fontVariant: ['tabular-nums']} : undefined}>{text}</Text>
    </View>
  );
  if (!isTV) return body(false);
  return <Focusable accessibilityRole="text" accessibilityLabel={text} radius={metrics.radius.control} scale={1}>{({focused}) => body(focused)}</Focusable>;
}

type DetailItem = {key: string; kind: 'facts'} | {key: string; kind: 'copyright'} | {key: string; kind: 'heading'} | {key: string; kind: 'missing'} | {key: string; kind: 'paragraph'; text: string};

export function LicenceScreen() {
  const i18n = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const route = useRoute<RouteProp<ContentStackParams, 'Licence'>>();
  const {space} = useTheme();
  const data = useLicences();
  const entry = useEntryFocus(!!data);
  const detail = useMemo(() => (data ? licenceDetail(data, route.params.id) : undefined), [data, route.params.id]);
  const paragraphs = useMemo(() => (detail?.text ? licenceParagraphs(detail.text) : []), [detail]);
  const header = <PageHeader title={detail?.component.name ?? i18n.t('licenses.title')} onBack={() => navigation.goBack()} />;
  if (!data || !detail) {
    return (
      <View style={{flex: 1}}>
        {header}
        <View style={{paddingHorizontal: space.page}}>
          {data === undefined ? <StateView loading title={i18n.t('licenses.loading')} /> : <StateView icon="error" title={i18n.t(data ? 'licenses.notFound' : 'licenses.unavailable')} />}
        </View>
      </View>
    );
  }
  const {component, copyright} = detail;
  const items: DetailItem[] = [
    {key: 'facts', kind: 'facts'},
    ...(copyright.length ? [{key: 'copyright', kind: 'copyright' as const}] : []),
    {key: 'heading', kind: 'heading'},
    ...(paragraphs.length ? paragraphs.map((text, i) => ({key: `p${i}`, kind: 'paragraph' as const, text})) : [{key: 'missing', kind: 'missing' as const}]),
  ];
  const render = ({item}: {item: DetailItem}) => {
    switch (item.kind) {
      case 'facts':
        return (
          <RowGroup>
            {component.version ? <ListRow readable hasTVPreferredFocus={isTV && entry} title={i18n.t('licenses.version')} meta={component.version} /> : null}
            <ListRow readable hasTVPreferredFocus={isTV && entry && !component.version} title={i18n.t('licenses.license')} subtitle={component.licence} subtitleLines={4} />
            {component.url ? (isTV
              ? <ListRow readable title={i18n.t('licenses.website')} subtitle={component.url} subtitleLines={2} />
              : <ListRow title={i18n.t('licenses.website')} subtitle={component.url} subtitleLines={2} trailingIcon="external" onPress={() => openLink(component.url!, i18n.t('link.openFailed', {address: component.url!}))} />) : null}
          </RowGroup>
        );
      case 'copyright':
        return <RowGroup title={i18n.t('licenses.copyright')}>{copyright.map(line => <ListRow key={line} readable title={line} />)}</RowGroup>;
      case 'heading':
        return <Text variant="captionStrong" tone="secondary" style={{paddingHorizontal: space.md, paddingTop: space.sm}}>{i18n.t('licenses.text')}</Text>;
      case 'missing':
        return <Paragraph text={i18n.t(component.textAtUrl ? 'licenses.textAtWebsite' : 'licenses.textMissing')} mono={false} />;
      case 'paragraph':
        return <Paragraph text={item.text} mono />;
    }
  };
  return (
    <View style={{flex: 1}}>
      <PageList
        data={items}
        keyExtractor={item => item.key}
        renderItem={render}
        ListHeaderComponent={header}
        style={{paddingHorizontal: space.page}}
        ItemSeparatorComponent={() => <View style={{height: space.sm}} />}
      />
    </View>
  );
}
