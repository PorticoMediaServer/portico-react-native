import React, {useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {CirclePause, CirclePlay, HardDrive, MoreHorizontal, Trash2} from 'lucide-react-native';
import type {MediaItem, PrototypePlatform} from '@portico-prototypes/contract';
import {mediaById, savedResources} from '@portico-prototypes/fixtures';
import {usePrototype} from '@portico-prototypes/runtime';
import {color, font, mobileType, tvType} from '../tokens';
import {ControlButton, EmptyState, Focusable, InlineNotice, UnderlineTabs} from '../primitives';
import {HeaderUtilities, MediaGrid} from '../sharedComponents';
import {usePrototypeUi} from '../uiState';
import {usePorticoNavigation} from '../navigation';

export function SavedScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {openDetail, openSearch} = usePorticoNavigation();
  const {state} = usePrototype();
  const {savedTab, setSavedTab} = usePrototypeUi();
  const tabs = ['Watchlist', 'Favorites', 'Playlists', 'Collections', 'Saved views'];
  const ids = savedTab === 'Favorites' ? state.favorites : state.watchlist;
  const items = ids.flatMap(id => {
    const item = mediaById.get(id);
    return item ? [item] : [];
  });

  return (
    <ScrollView
      contentContainerStyle={[styles.page, television && styles.pageTv]}
      showsVerticalScrollIndicator={false}
      testID={`portico-four-saved-${platform}`}>
      <HeaderUtilities flush onSearch={openSearch} platform={platform} title="Saved" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <UnderlineTabs active={savedTab} onChange={setSavedTab} platform={platform} tabs={tabs} />
      </ScrollView>
      {state.scenario === 'stale-offline' ? (
        <View style={styles.notice}>
          <InlineNotice kind="warning" message="Saved membership is cached. Changes will sync when this server reconnects." platform={platform} />
        </View>
      ) : null}
      <View style={[styles.savedContent, television && styles.savedContentTv]}>
        {savedTab === 'Playlists' || savedTab === 'Collections' || savedTab === 'Saved views' ? (
          <SavedResources kind={savedTab} onOpen={openDetail} platform={platform} />
        ) : items.length ? (
          <MediaGrid items={items} onOpen={item => openDetail(item.id)} platform={platform} />
        ) : (
          <EmptyState
            message={`Media added to ${savedTab.toLowerCase()} appears here across your Portico clients.`}
            platform={platform}
            title={`No ${savedTab.toLowerCase()} yet`}
          />
        )}
      </View>
    </ScrollView>
  );
}

function SavedResources({kind, onOpen, platform}: {kind: string; onOpen(id: string): void; platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const resources = kind === 'Playlists'
    ? savedResources.filter(resource => resource.kind === 'playlist')
    : kind === 'Collections'
      ? savedResources.filter(resource => resource.kind === 'collection')
      : savedResources.filter(resource => resource.kind === 'view');
  return (
    <View style={[styles.resourceList, television && styles.resourceListTv]}>
      {resources.map(resource => {
        const firstId = resource.itemIds[0];
        const first = firstId ? mediaById.get(firstId) : undefined;
        return (
          <Focusable
            accessibilityLabel={`${resource.title}. ${resource.itemIds.length} items.`}
            accessibilityRole="button"
            key={resource.id}
            onPress={() => first && onOpen(first.id)}
            platform={platform}
            style={[styles.resource, television && styles.resourceTv]}
            focusedStyle={styles.resourceFocused}
            pressedStyle={styles.resourcePressed}>
            {first ? <Image resizeMode="cover" source={{uri: first.poster}} style={television ? styles.resourceImageTv : styles.resourceImageMobile} /> : null}
            <View style={styles.resourceCopy}>
              <Text style={television ? styles.resourceTitleTv : styles.resourceTitleMobile}>{resource.title}</Text>
              <Text style={television ? styles.resourceMetaTv : styles.resourceMetaMobile}>{resource.itemIds.length} items  ·  {resource.visibility}</Text>
              <Text numberOfLines={2} style={television ? styles.resourceSummaryTv : styles.resourceSummaryMobile}>{resource.summary}</Text>
            </View>
            <MoreHorizontal color={color.dimSilver} size={television ? 32 : 22} strokeWidth={2} />
          </Focusable>
        );
      })}
    </View>
  );
}

interface DownloadRecord {
  id: string;
  media: MediaItem;
  progress: number;
  status: 'downloading' | 'queued' | 'offline';
  detail: string;
}

export function DownloadsScreen({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const {openDetail, openSearch} = usePorticoNavigation();
  const [paused, setPaused] = useState(false);
  const records = [
    makeDownload('fargo', 68, 'downloading', paused ? 'Paused · 1.8 GB of 2.7 GB' : '8 min remaining · 1.8 GB of 2.7 GB'),
    makeDownload('project-hail-mary', 0, 'queued', 'Queued · 684 MB'),
    makeDownload('martian', 100, 'offline', 'Available offline · 4K · 6.2 GB'),
    makeDownload('black-sands', 100, 'offline', 'Available offline · Lossless · 442 MB'),
  ].filter((record): record is DownloadRecord => Boolean(record));
  const active = records.filter(record => record.status === 'downloading');
  const queued = records.filter(record => record.status === 'queued');
  const complete = records.filter(record => record.status === 'offline').map(record => record.media);

  return (
    <ScrollView
      contentContainerStyle={[styles.page, television && styles.pageTv]}
      showsVerticalScrollIndicator={false}
      testID={`portico-four-downloads-${platform}`}>
      <HeaderUtilities flush onSearch={openSearch} platform={platform} title="Downloads" />
      <View style={[styles.storage, television && styles.storageTv]}>
        <HardDrive color={color.screenBlue} size={television ? 38 : 24} strokeWidth={1.8} />
        <View style={styles.storageCopy}>
          <Text style={television ? styles.storageTitleTv : styles.storageTitleMobile}>18.6 GB used by Portico</Text>
          <Text style={television ? styles.storageMetaTv : styles.storageMetaMobile}>46.3 GB available on this device · Automatic quality</Text>
          <View style={[styles.storageTrack, television && styles.storageTrackTv]}>
            <View style={styles.storageValue} />
          </View>
        </View>
        <ControlButton label="Manage" onPress={() => undefined} platform={platform} />
      </View>
      <Text style={[television ? tvType.section : mobileType.section, styles.sectionTitle]}>Downloading</Text>
      <View style={[styles.downloadList, television && styles.downloadListTv]}>
        {active.map(record => (
          <DownloadRow key={record.id} onPause={() => setPaused(value => !value)} paused={paused && record.status === 'downloading'} platform={platform} record={record} />
        ))}
      </View>
      <Text style={[television ? tvType.section : mobileType.section, styles.sectionTitle, styles.offlineTitle]}>Queued</Text>
      <View style={[styles.downloadList, television && styles.downloadListTv]}>
        {queued.map(record => <DownloadRow key={record.id} platform={platform} record={record} />)}
      </View>
      <Text style={[television ? tvType.section : mobileType.section, styles.sectionTitle, styles.offlineTitle]}>Available offline</Text>
      {complete.length ? <MediaGrid items={complete} onOpen={item => openDetail(item.id)} platform={platform} /> : null}
    </ScrollView>
  );
}

function DownloadRow({
  onPause,
  paused = false,
  platform,
  record,
}: {
  onPause?(): void;
  paused?: boolean;
  platform: PrototypePlatform;
  record: DownloadRecord;
}) {
  const television = platform === 'tv';
  return (
    <View style={[styles.downloadRow, television && styles.downloadRowTv]}>
      <Image resizeMode="cover" source={{uri: record.media.poster}} style={television ? styles.downloadImageTv : styles.downloadImageMobile} />
      <View style={styles.downloadCopy}>
        <Text numberOfLines={1} style={television ? styles.downloadTitleTv : styles.downloadTitleMobile}>{record.media.title}</Text>
        <Text style={television ? styles.downloadMetaTv : styles.downloadMetaMobile}>{record.detail}</Text>
        <View style={[styles.downloadTrack, television && styles.downloadTrackTv]}>
          <View style={[styles.downloadValue, {width: `${record.progress}%`}]} />
        </View>
      </View>
      {onPause ? <ControlButton compact icon={paused ? CirclePlay : CirclePause} onPress={onPause} platform={platform} /> : null}
      <ControlButton compact icon={Trash2} onPress={() => undefined} platform={platform} />
    </View>
  );
}

function makeDownload(id: string, progress: number, status: DownloadRecord['status'], detail: string): DownloadRecord | undefined {
  const media = mediaById.get(id);
  return media ? {detail, id, media, progress, status} : undefined;
}

const styles = StyleSheet.create({
  page: {backgroundColor: color.projector, minHeight: '100%', paddingHorizontal: 16, paddingTop: 8},
  pageTv: {paddingLeft: 0, paddingRight: 72, paddingTop: 10},
  notice: {marginTop: 16},
  savedContent: {marginTop: 20},
  savedContentTv: {marginTop: 28},
  resourceList: {gap: 8, paddingBottom: 100},
  resourceListTv: {columnGap: 16, flexDirection: 'row', flexWrap: 'wrap', rowGap: 16},
  resource: {alignItems: 'center', backgroundColor: color.recess, borderColor: color.lineSoft, borderRadius: 8, borderWidth: 3, flexDirection: 'row', gap: 12, minHeight: 116, padding: 8},
  resourceTv: {gap: 18, minHeight: 172, padding: 12, width: '48.8%'},
  resourceFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  resourcePressed: {backgroundColor: color.brightSlate},
  resourceImageMobile: {borderRadius: 6, height: 92, width: 62},
  resourceImageTv: {borderRadius: 6, height: 144, width: 96},
  resourceCopy: {flex: 1},
  resourceTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 17, lineHeight: 22},
  resourceTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 25, lineHeight: 31},
  resourceMetaMobile: {color: color.screenBlue, fontFamily: font.medium, fontSize: 12, lineHeight: 16, marginTop: 2},
  resourceMetaTv: {color: color.screenBlue, fontFamily: font.medium, fontSize: 18, lineHeight: 24, marginTop: 3},
  resourceSummaryMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 13, lineHeight: 18, marginTop: 6},
  resourceSummaryTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 19, lineHeight: 26, marginTop: 8},
  storage: {alignItems: 'center', backgroundColor: color.recess, borderColor: color.lineSoft, borderWidth: 1, flexDirection: 'row', gap: 12, marginBottom: 28, marginTop: 14, padding: 14},
  storageTv: {gap: 18, marginBottom: 38, marginTop: 20, padding: 20},
  storageCopy: {flex: 1},
  storageTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 15},
  storageTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 23},
  storageMetaMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 11, marginTop: 2},
  storageMetaTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 17, marginTop: 3},
  storageTrack: {backgroundColor: color.brightSlate, height: 4, marginTop: 10, maxWidth: 440},
  storageTrackTv: {height: 6, marginTop: 13, maxWidth: 650},
  storageValue: {backgroundColor: color.screenBlue, height: '100%', width: '34%'},
  sectionTitle: {color: color.silver, marginBottom: 14},
  offlineTitle: {marginTop: 32},
  downloadList: {gap: 8},
  downloadListTv: {gap: 12},
  downloadRow: {alignItems: 'center', backgroundColor: color.recess, borderBottomColor: color.lineSoft, borderBottomWidth: 1, flexDirection: 'row', gap: 8, minHeight: 108, padding: 8},
  downloadRowTv: {gap: 14, minHeight: 152, padding: 10},
  downloadImageMobile: {borderRadius: 5, height: 88, width: 59},
  downloadImageTv: {borderRadius: 6, height: 132, width: 88},
  downloadCopy: {flex: 1},
  downloadTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 15, lineHeight: 20},
  downloadTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 23, lineHeight: 29},
  downloadMetaMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 11, lineHeight: 15, marginTop: 2},
  downloadMetaTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 17, lineHeight: 23, marginTop: 3},
  downloadTrack: {backgroundColor: color.brightSlate, height: 4, marginTop: 10, width: '100%'},
  downloadTrackTv: {height: 6, marginTop: 13},
  downloadValue: {backgroundColor: color.screenBlue, height: '100%'},
});
