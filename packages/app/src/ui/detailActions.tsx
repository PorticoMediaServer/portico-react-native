import React, {useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TVFocusGuideView,
  View,
} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import type {PorticoClient} from '@portico/client-core';
import {
  productErrorMessageId,
  useViewerRuntime,
} from '@portico-react-native/infrastructure';
import {PorticoIcon} from '@portico-react-native/icons';
import {
  activeQueueAvailability,
  addMediaToActiveQueue,
  addMediaToDetailTarget,
  createDetailTarget,
  detailMenuCapabilities,
  editableDetailTargets,
  type DetailQueuePosition,
  type DetailSavedTarget,
  type DetailSavedTargetKind,
} from '../data';
import type {MediaDetailViewModel} from '../data/contracts';
import type {
  TVFocusDirection,
  TVLogicalFocusNode,
} from '@portico-react-native/tv-focus';
import type {PrototypePlatform} from '../ui-compat/contract';
import {
  ControlButton,
  Focusable,
  IconGlyph,
  IconButton,
  InlineNotice,
  type PorticoIconSource,
  useTVModalFocusRestoration,
} from './primitives';
import {color, font, mobileType, radius, tvType} from './tokens';
import {useModalAnimationType} from './useReducedMotion';
import {productText} from './productCopy';

type SheetMode = 'menu' | 'rating' | 'version' | DetailSavedTargetKind;

export function DetailMoreAction({
  client,
  item,
  onPlayVersion,
  platform,
  secondaryActions = [],
  tvFocusNeighbours,
  tvFocusBoundaryDirections,
}: {
  client: PorticoClient;
  item: MediaDetailViewModel;
  onPlayVersion(versionId: string): void;
  platform: PrototypePlatform;
  secondaryActions?: Array<{
    description: string;
    icon: PorticoIconSource;
    id: string;
    label: string;
    onPress(): void;
  }>;
  tvFocusNeighbours?: TVLogicalFocusNode['neighbours'];
  tvFocusBoundaryDirections?: readonly TVFocusDirection[];
}) {
  const television = platform === 'tv';
  const queryClient = useQueryClient();
  const viewerRuntime = useViewerRuntime();
  const capabilities = detailMenuCapabilities(item.actions);
  const queueQuery = useQuery({
    enabled: capabilities.queue,
    queryKey: ['active-detail-queue'],
    queryFn: () =>
      viewerRuntime.runRequest(signal =>
        activeQueueAvailability(client, signal),
      ),
    refetchInterval: false,
    staleTime: 5_000,
  });
  const queueAvailable = Boolean(
    queueQuery.data?.available && queueQuery.data.currentMediaId !== item.id,
  );
  const playableVersions = (item.raw.mediaFiles ?? []).filter(
    version => version.available,
  );
  const hasMenu =
    playableVersions.length > 1 ||
    capabilities.collection ||
    capabilities.playlist ||
    capabilities.rating ||
    capabilities.reaction ||
    queueAvailable ||
    secondaryActions.length > 0;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SheetMode>('menu');
  const [targets, setTargets] = useState<DetailSavedTarget[]>([]);
  const [targetLoading, setTargetLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [complete, setComplete] = useState<string>();
  const [draftTitle, setDraftTitle] = useState('');
  const [selectedRating, setSelectedRating] = useState(
    item.raw.state.rating ?? 0,
  );
  const animationType = useModalAnimationType();
  const modalFocus = useTVModalFocusRestoration(television && open);

  if (!hasMenu) return null;

  const resetStatus = () => {
    setError(undefined);
    setComplete(undefined);
  };
  const dismiss = () => {
    if (busy) return;
    setOpen(false);
    setMode('menu');
    resetStatus();
  };
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({queryKey: ['media', item.id]}),
      queryClient.invalidateQueries({queryKey: ['home']}),
      queryClient.invalidateQueries({queryKey: ['watchlist']}),
      queryClient.invalidateQueries({queryKey: ['favorites']}),
      queryClient.invalidateQueries({queryKey: ['saved-resources']}),
      queryClient.invalidateQueries({queryKey: ['saved-resource-items']}),
      queryClient.invalidateQueries({queryKey: ['active-detail-queue']}),
    ]);
  };
  const run = async (
    operation: (signal: AbortSignal) => Promise<unknown>,
    success: string,
  ) => {
    setBusy(true);
    resetStatus();
    try {
      await viewerRuntime.runRequest(operation);
      setComplete(success);
      await invalidate();
    } catch (cause) {
      setError(
        productErrorMessageId(cause, 'catalog.action-failed', {
          actionName: 'complete that action',
        }),
      );
    } finally {
      setBusy(false);
    }
  };
  const openTargets = async (kind: DetailSavedTargetKind) => {
    setMode(kind);
    setTargetLoading(true);
    resetStatus();
    try {
      setTargets(
        await viewerRuntime.runRequest(signal =>
          editableDetailTargets(client, kind, signal),
        ),
      );
    } catch (cause) {
      setTargets([]);
      setError(
        productErrorMessageId(cause, 'media.load-failed', {
          featureName: `Your ${kind}s`,
        }),
      );
    } finally {
      setTargetLoading(false);
    }
  };
  const addToTarget = (target: DetailSavedTarget) =>
    run(
      signal =>
        addMediaToDetailTarget(
          client,
          mode as DetailSavedTargetKind,
          target,
          item.id,
          signal,
        ),
      `Added to ${target.title}.`,
    );
  const createTarget = async () => {
    const kind = mode as DetailSavedTargetKind;
    await run(async signal => {
      const created = await createDetailTarget(
        client,
        kind,
        draftTitle,
        item.id,
        signal,
      );
      setTargets(current => [created, ...current]);
      setDraftTitle('');
    }, `Created ${draftTitle.trim()} and added this title.`);
  };
  const updateReaction = (reaction: 'like' | 'dislike') => {
    const current = item.state.reaction ?? '';
    const next = current === reaction ? '' : reaction;
    return run(
      signal => client.setReaction(item.id, next, {signal}),
      next
        ? `${reaction === 'like' ? 'Like' : 'Dislike'} saved.`
        : 'Reaction removed.',
    );
  };
  const saveRating = (rating: number) =>
    run(
      signal => client.setRating(item.id, rating, {signal}),
      rating ? `Rated ${rating} out of 10.` : 'Rating cleared.',
    );
  const addQueue = (position: DetailQueuePosition) =>
    run(
      signal => addMediaToActiveQueue(client, item.id, position, signal),
      position === 'play_next'
        ? 'This title will play next.'
        : 'Added to the end of the active queue.',
    );

  const panel = (
    <View
      style={[styles.panel, television ? styles.panelTv : styles.panelMobile]}
    >
      <View style={[styles.header, television && styles.headerTv]}>
        {mode !== 'menu' ? (
          <IconButton
            icon="navigation.back"
            label="Back to more actions"
            onPress={() => {
              setMode('menu');
              resetStatus();
            }}
            platform={platform}
          />
        ) : null}
        <View style={styles.headingCopy}>
          <Text
            numberOfLines={1}
            style={television ? styles.contextTv : styles.contextMobile}
          >
            {item.title}
          </Text>
          <Text
            style={[
              television ? tvType.section : mobileType.section,
              styles.panelTitle,
            ]}
          >
            {modeTitle(mode)}
          </Text>
        </View>
        <IconButton
          icon="action.close"
          label="Close more actions"
          onPress={dismiss}
          platform={platform}
        />
      </View>
      <View style={styles.rule} />
      <ScrollView
        contentContainerStyle={[styles.body, television && styles.bodyTv]}
        showsVerticalScrollIndicator={false}
      >
        {mode === 'menu' ? (
          <>
            {secondaryActions.map(action => (
              <ActionRow
                description={action.description}
                icon={action.icon}
                key={action.id}
                label={action.label}
                onPress={action.onPress}
                platform={platform}
              />
            ))}
            {queueAvailable ? (
              <>
                <ActionRow
                  description="Place this title immediately after what is playing"
                  icon="playback.next"
                  label={productText('action.play-next')}
                  onPress={() => void addQueue('play_next')}
                  platform={platform}
                />
                <ActionRow
                  description="Place this title at the end of the active queue"
                  icon="playback.queue"
                  label={productText('action.add-queue')}
                  onPress={() => void addQueue('append')}
                  platform={platform}
                />
              </>
            ) : null}
            {playableVersions.length > 1 ? (
              <ActionRow
                description={productText('playback.version-description')}
                icon="media.movie"
                label={productText('action.play-version')}
                onPress={() => {
                  setMode('version');
                  resetStatus();
                }}
                platform={platform}
              />
            ) : null}
            {capabilities.playlist ? (
              <ActionRow
                description="Choose or create an ordered playlist"
                icon="media.playlist"
                label={productText('action.add-playlist')}
                onPress={() => void openTargets('playlist')}
                platform={platform}
              />
            ) : null}
            {capabilities.collection ? (
              <ActionRow
                description="Choose or create a collection"
                icon="library.collection"
                label={productText('action.add-collection')}
                onPress={() => void openTargets('collection')}
                platform={platform}
              />
            ) : null}
            {capabilities.rating ? (
              <ActionRow
                description={
                  item.raw.state.rating
                    ? `Currently ${item.raw.state.rating} out of 10`
                    : 'Help tune recommendations for this account'
                }
                icon="action.rate"
                label={productText('action.rate')}
                onPress={() => {
                  setSelectedRating(item.raw.state.rating ?? 0);
                  setMode('rating');
                  resetStatus();
                }}
                platform={platform}
                selected={Boolean(item.raw.state.rating)}
              />
            ) : null}
            {capabilities.reaction ? (
              <>
                <ActionRow
                  icon="action.like"
                  label={
                    item.state.reaction === 'like' ? 'Remove like' : 'Like'
                  }
                  onPress={() => void updateReaction('like')}
                  platform={platform}
                  selected={item.state.reaction === 'like'}
                />
                <ActionRow
                  icon="action.dislike"
                  label={
                    item.state.reaction === 'dislike'
                      ? 'Remove dislike'
                      : 'Dislike'
                  }
                  onPress={() => void updateReaction('dislike')}
                  platform={platform}
                  selected={item.state.reaction === 'dislike'}
                />
              </>
            ) : null}
          </>
        ) : null}
        {mode === 'rating' ? (
          <RatingOptions
            busy={busy}
            current={item.raw.state.rating ?? 0}
            onChange={setSelectedRating}
            onSave={rating => void saveRating(rating)}
            platform={platform}
            selected={selectedRating}
          />
        ) : null}
        {mode === 'version' ? (
          <View style={styles.targets}>
            {playableVersions.map(version => (
              <ActionRow
                description={[
                  version.resolution,
                  version.dynamicRange,
                  version.videoCodec?.toUpperCase(),
                  version.audioCodec?.toUpperCase(),
                  version.container?.toUpperCase(),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                icon="media.movie"
                key={version.id}
                label={`${version.versionLabel || version.resolution || productText('action.play-version')}${version.selected ? ` · ${productText('media.default-version')}` : ''}`}
                onPress={() => {
                  dismiss();
                  onPlayVersion(version.id);
                }}
                platform={platform}
                selected={version.selected}
              />
            ))}
          </View>
        ) : null}
        {mode === 'playlist' || mode === 'collection' ? (
          <SavedTargets
            busy={busy}
            draftTitle={draftTitle}
            kind={mode}
            loading={targetLoading}
            onAdd={target => void addToTarget(target)}
            onCreate={() => void createTarget()}
            onDraftTitle={setDraftTitle}
            platform={platform}
            targets={targets}
          />
        ) : null}
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={color.screenBlueStrong} />
            <Text style={television ? styles.busyTv : styles.busyMobile}>
              Saving…
            </Text>
          </View>
        ) : null}
        {error ? (
          <InlineNotice kind="error" message={error} platform={platform} />
        ) : null}
        {complete ? (
          <InlineNotice kind="info" message={complete} platform={platform} />
        ) : null}
      </ScrollView>
    </View>
  );

  return (
    <>
      <IconButton
        icon="action.more"
        label={`More actions for ${item.title}`}
        onPress={() => {
          setOpen(true);
          setMode('menu');
          resetStatus();
        }}
        platform={platform}
        tvFocusBoundaryDirections={tvFocusBoundaryDirections}
        tvFocusNeighbours={tvFocusNeighbours}
      />
      <Modal
        animationType={animationType}
        onDismiss={modalFocus.onDismiss}
        onRequestClose={dismiss}
        presentationStyle="overFullScreen"
        transparent
        visible={open}
      >
        <View accessibilityViewIsModal style={styles.layer}>
          <Pressable
            accessibilityElementsHidden
            accessible={false}
            focusable={false}
            onPress={dismiss}
            style={styles.scrim}
          />
          {television ? (
            <TVFocusGuideView
              autoFocus
              trapFocusDown
              trapFocusLeft
              trapFocusRight
              trapFocusUp
              style={styles.panelFocusGuide}
            >
              {panel}
            </TVFocusGuideView>
          ) : (
            panel
          )}
        </View>
      </Modal>
    </>
  );
}

function ActionRow({
  description,
  icon,
  label,
  onPress,
  platform,
  selected,
}: {
  description?: string;
  icon: PorticoIconSource;
  label: string;
  onPress(): void;
  platform: PrototypePlatform;
  selected?: boolean;
}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={`${label}${description ? `. ${description}` : ''}`}
      accessibilityRole="button"
      accessibilityState={{selected}}
      onPress={onPress}
      platform={platform}
      pressedStyle={styles.rowPressed}
      focusedStyle={styles.rowFocused}
      style={[
        styles.row,
        television && styles.rowTv,
        selected && styles.rowSelected,
      ]}
    >
      <IconGlyph
        color={selected ? color.screenBlueStrong : color.softSilver}
        icon={icon}
        size={television ? 29 : 21}
        state={selected ? 'selected' : 'default'}
      />
      <View style={styles.rowCopy}>
        <Text style={television ? styles.rowTitleTv : styles.rowTitleMobile}>
          {label}
        </Text>
        {description ? (
          <Text
            style={
              television ? styles.rowDescriptionTv : styles.rowDescriptionMobile
            }
          >
            {description}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <PorticoIcon
          color={color.screenBlueStrong}
          id="status.selected"
          size={television ? 27 : 20}
          state="selected"
        />
      ) : null}
    </Focusable>
  );
}

function RatingOptions({
  busy,
  current,
  onChange,
  onSave,
  platform,
  selected,
}: {
  busy: boolean;
  current: number;
  onChange(value: number): void;
  onSave(value: number): void;
  platform: PrototypePlatform;
  selected: number;
}) {
  const television = platform === 'tv';
  return (
    <View style={styles.rating}>
      <View style={styles.score}>
        <PorticoIcon
          color={color.screenBlueStrong}
          id="action.rate"
          size={television ? 42 : 30}
          state={selected ? 'selected' : 'default'}
        />
        <Text
          style={television ? styles.scoreValueTv : styles.scoreValueMobile}
        >
          {selected || '—'}
        </Text>
        <Text
          style={television ? styles.scoreSuffixTv : styles.scoreSuffixMobile}
        >
          out of 10
        </Text>
      </View>
      <View
        accessibilityLabel="Rating"
        accessibilityRole="radiogroup"
        style={styles.ratingGrid}
      >
        {Array.from({length: 10}, (_, index) => index + 1).map(value => (
          <Focusable
            accessibilityLabel={`${value} out of 10`}
            accessibilityRole="radio"
            accessibilityState={{checked: selected === value}}
            disabled={busy}
            focusedStyle={styles.ratingOptionFocused}
            key={value}
            onPress={() => onChange(value)}
            platform={platform}
            pressedStyle={styles.rowPressed}
            style={[
              styles.ratingOption,
              television && styles.ratingOptionTv,
              selected === value && styles.ratingOptionSelected,
            ]}
          >
            <Text
              style={[
                television ? styles.ratingLabelTv : styles.ratingLabelMobile,
                selected === value && styles.ratingLabelSelected,
              ]}
            >
              {value}
            </Text>
          </Focusable>
        ))}
      </View>
      <View style={styles.footerActions}>
        {current > 0 ? (
          <ControlButton
            compact
            disabled={busy}
            label="Clear rating"
            onPress={() => onSave(0)}
            platform={platform}
          />
        ) : null}
        <ControlButton
          disabled={busy || selected < 1}
          label="Save rating"
          onPress={() => onSave(selected)}
          platform={platform}
          primary
        />
      </View>
    </View>
  );
}

function SavedTargets({
  busy,
  draftTitle,
  kind,
  loading,
  onAdd,
  onCreate,
  onDraftTitle,
  platform,
  targets,
}: {
  busy: boolean;
  draftTitle: string;
  kind: DetailSavedTargetKind;
  loading: boolean;
  onAdd(target: DetailSavedTarget): void;
  onCreate(): void;
  onDraftTitle(value: string): void;
  platform: PrototypePlatform;
  targets: DetailSavedTarget[];
}) {
  const television = platform === 'tv';
  const label = kind === 'playlist' ? 'playlist' : 'collection';
  const icon = kind === 'playlist' ? 'media.playlist' : 'library.saved';
  return (
    <View style={styles.targets}>
      {loading ? (
        <View style={styles.busy}>
          <ActivityIndicator color={color.screenBlueStrong} />
          <Text style={television ? styles.busyTv : styles.busyMobile}>
            Loading {label}s…
          </Text>
        </View>
      ) : null}
      {!loading
        ? targets.map(target => (
            <ActionRow
              description={`${target.itemCount} ${target.itemCount === 1 ? 'item' : 'items'} · ${target.visibility === 'server' ? 'Shared' : 'Private'}`}
              icon={icon}
              key={target.id}
              label={target.title}
              onPress={() => onAdd(target)}
              platform={platform}
            />
          ))
        : null}
      {!loading && !targets.length ? (
        <Text style={television ? styles.emptyTv : styles.emptyMobile}>
          You do not have an editable {label} yet.
        </Text>
      ) : null}
      <View style={[styles.create, television && styles.createTv]}>
        <TextInput
          accessibilityLabel={`New ${label} name`}
          editable={!busy}
          maxLength={160}
          onChangeText={onDraftTitle}
          placeholder={`New ${label} name`}
          placeholderTextColor={color.mutedSilver}
          style={[styles.input, television && styles.inputTv]}
          value={draftTitle}
        />
        <ControlButton
          compact
          disabled={busy || !draftTitle.trim()}
          icon="action.add"
          label={`Create ${label}`}
          onPress={onCreate}
          platform={platform}
        />
      </View>
    </View>
  );
}

function modeTitle(mode: SheetMode): string {
  if (mode === 'version') return productText('playback.version-title');
  if (mode === 'rating') return 'Your rating';
  if (mode === 'playlist') return 'Add to playlist';
  if (mode === 'collection') return 'Add to collection';
  return 'More actions';
}

const styles = StyleSheet.create({
  layer: {flex: 1},
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.74)',
  },
  panel: {
    backgroundColor: 'rgba(16,24,32,0.94)',
    borderColor: color.lineStrong,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'absolute',
  },
  panelMobile: {
    borderTopLeftRadius: radius.overlay,
    borderTopRightRadius: radius.overlay,
    bottom: 0,
    left: 0,
    maxHeight: '82%',
    right: 0,
  },
  panelTv: {
    borderRadius: radius.overlay,
    maxHeight: '82%',
    right: 90,
    top: 90,
    width: 720,
  },
  panelFocusGuide: {...StyleSheet.absoluteFillObject},
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 76,
    paddingHorizontal: 16,
  },
  headerTv: {gap: 16, minHeight: 96, paddingHorizontal: 22},
  headingCopy: {flex: 1},
  panelTitle: {color: color.silver},
  contextMobile: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  contextTv: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 17,
    lineHeight: 22,
  },
  rule: {backgroundColor: color.line, height: 1},
  body: {gap: 8, padding: 10, paddingBottom: 30},
  bodyTv: {gap: 10, padding: 14, paddingBottom: 24},
  row: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: radius.control,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 12,
    minHeight: 62,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowTv: {gap: 18, minHeight: 84, paddingHorizontal: 16, paddingVertical: 10},
  rowSelected: {backgroundColor: color.raisedSlate},
  rowFocused: {backgroundColor: color.brightSlate, borderColor: color.focus},
  rowPressed: {backgroundColor: color.recess},
  rowCopy: {flex: 1},
  rowTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 16,
    lineHeight: 21,
  },
  rowTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 23,
    lineHeight: 29,
  },
  rowDescriptionMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  rowDescriptionTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 17,
    lineHeight: 23,
    marginTop: 3,
  },
  busy: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 12,
  },
  busyMobile: {color: color.softSilver, fontFamily: font.regular, fontSize: 14},
  busyTv: {color: color.softSilver, fontFamily: font.regular, fontSize: 20},
  rating: {gap: 22, padding: 10},
  score: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
  },
  scoreValueMobile: {color: color.silver, fontFamily: font.bold, fontSize: 36},
  scoreValueTv: {color: color.silver, fontFamily: font.bold, fontSize: 52},
  scoreSuffixMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 14,
  },
  scoreSuffixTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 20,
  },
  ratingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  ratingOption: {
    alignItems: 'center',
    borderColor: color.line,
    borderRadius: radius.control,
    borderWidth: 2,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  ratingOptionTv: {height: 64, width: 64},
  ratingOptionSelected: {
    backgroundColor: color.brightSlate,
    borderColor: color.screenBlueStrong,
  },
  ratingOptionFocused: {
    backgroundColor: color.brightSlate,
    borderColor: color.focus,
  },
  ratingLabelMobile: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 16,
  },
  ratingLabelTv: {color: color.softSilver, fontFamily: font.demi, fontSize: 23},
  ratingLabelSelected: {color: color.screenBlueStrong},
  footerActions: {flexDirection: 'row', gap: 10, justifyContent: 'flex-end'},
  targets: {gap: 8},
  emptyMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
  },
  emptyTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 20,
    lineHeight: 28,
    padding: 16,
  },
  create: {
    alignItems: 'center',
    borderTopColor: color.lineSoft,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
    paddingHorizontal: 2,
    paddingTop: 14,
  },
  createTv: {gap: 14, paddingTop: 18},
  input: {
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: radius.control,
    borderWidth: 1,
    color: color.silver,
    flex: 1,
    fontFamily: font.regular,
    fontSize: 15,
    height: 48,
    paddingHorizontal: 13,
  },
  inputTv: {fontSize: 21, height: 60, paddingHorizontal: 16},
});
