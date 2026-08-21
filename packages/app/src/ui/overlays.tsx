import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TVFocusGuideView,
  View,
} from 'react-native';
import {
  formatTVSetupCode,
  hostedClient,
  productErrorMessageId,
  productMessageText,
  subscribeToNearbyTVSetups,
  usePorticoAuth,
  type NearbyPorticoSetupDevice,
} from '@portico-react-native/infrastructure';
import {
  AirPlayRoutePicker,
  GoogleCastButton,
  googleCastPlaybackSupported,
  subscribeToGoogleCastState,
  type GoogleCastState,
} from '@portico-react-native/player';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {PorticoIcon, type PorticoIconId} from '@portico-react-native/icons';
import type {PrototypePlatform} from '../ui-compat/contract';
import {
  availableSorts,
  useLibraryCatalog,
  type ConnectedLibrary,
  type LibraryFilterPredicate,
} from '../data/library';
import {color, font, mobileType, radius, tvType} from './tokens';
import {
  ControlButton,
  Focusable,
  IconButton,
  useTVModalFocusRestoration,
} from './primitives';
import {usePrototypeUi, type OverlayId} from './uiState';
import {usePorticoNavigationActions} from './navigation';
import {useModalAnimationType} from './useReducedMotion';
import {productText} from './productCopy';
import {useEngagement} from './engagement';

export function PrototypeOverlay({platform}: {platform: PrototypePlatform}) {
  const {overlay, setOverlay} = usePrototypeUi();
  const insets = useSafeAreaInsets();
  const animationType = useModalAnimationType();
  const modalFocus = useTVModalFocusRestoration(
    platform === 'tv' && Boolean(overlay),
  );
  if (!overlay) {
    return null;
  }
  if (platform === 'tv' && (overlay === 'cast' || overlay === 'profile')) {
    return null;
  }
  return (
    <Modal
      animationType={animationType}
      onDismiss={modalFocus.onDismiss}
      onRequestClose={() => setOverlay(null)}
      transparent
      visible
    >
      <View style={styles.layer} testID={`portico-four-overlay-${overlay}`}>
        <Pressable
          accessible={false}
          focusable={false}
          onPress={() => setOverlay(null)}
          style={styles.scrim}
        />
        <OverlayPanel
          abandonFocus={modalFocus.abandon}
          bottomInset={insets.bottom}
          overlay={overlay}
          platform={platform}
        />
      </View>
    </Modal>
  );
}

function OverlayPanel({
  abandonFocus,
  bottomInset,
  overlay,
  platform,
}: {
  abandonFocus(): void;
  bottomInset: number;
  overlay: Exclude<OverlayId, null>;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  const {setOverlay} = usePrototypeUi();
  const title = overlayTitle(overlay);
  const contents = (
    <>
      <View style={[styles.panelHeader, television && styles.panelHeaderTv]}>
        <Text
          style={[
            television ? tvType.section : mobileType.section,
            styles.panelTitle,
          ]}
        >
          {title}
        </Text>
        <IconButton
          icon="action.close"
          label={productText('action.close')}
          onPress={() => setOverlay(null)}
          platform={platform}
        />
      </View>
      <View style={styles.rule} />
      <View
        style={
          !television && bottomInset ? {paddingBottom: bottomInset} : undefined
        }
      >
        <OverlayContent
          abandonFocus={abandonFocus}
          overlay={overlay}
          platform={platform}
        />
      </View>
    </>
  );
  return television ? (
    <TVFocusGuideView
      autoFocus
      key={overlay}
      trapFocusDown
      trapFocusLeft
      trapFocusRight
      trapFocusUp
      style={[styles.panel, styles.panelTv]}
    >
      {contents}
    </TVFocusGuideView>
  ) : (
    <View accessibilityViewIsModal style={[styles.panel, styles.panelMobile]}>
      {contents}
    </View>
  );
}

function OverlayContent({
  abandonFocus,
  overlay,
  platform,
}: {
  abandonFocus(): void;
  overlay: Exclude<OverlayId, null>;
  platform: PrototypePlatform;
}) {
  switch (overlay) {
    case 'library':
      return <LibraryOptions platform={platform} />;
    case 'filters':
      return <FilterOptions platform={platform} />;
    case 'sort':
      return <SortOptions platform={platform} />;
    case 'view':
      return <ViewOptions platform={platform} />;
    case 'profile':
      return <ProfileOptions abandonFocus={abandonFocus} platform={platform} />;
    case 'cast':
      return <CastOptions platform={platform} />;
    default:
      return null;
  }
}

function LibraryOptions({platform}: {platform: PrototypePlatform}) {
  const {selectedLibraryId, setLibraryTab, setOverlay, setSelectedLibraryId} =
    usePrototypeUi();
  const catalog = useLibraryCatalog(selectedLibraryId);
  if (catalog.isLoading)
    return (
      <Text style={platform === 'tv' ? styles.helperTv : styles.helperMobile}>
        Loading libraries…
      </Text>
    );
  if (catalog.error && !catalog.data)
    return (
      <Text style={platform === 'tv' ? styles.helperTv : styles.helperMobile}>
        {productErrorMessageId(catalog.error, 'library.load-failed')}
      </Text>
    );
  return (
    <ScrollView
      contentContainerStyle={styles.options}
      showsVerticalScrollIndicator={false}
    >
      {(catalog.data?.libraries ?? []).map(library => (
        <OptionRow
          description={library.description}
          icon={
            library.kind === 'recorded-tv'
              ? 'media.live-tv'
              : library.kind === 'music'
                ? 'media.music'
                : 'media.collection'
          }
          key={library.id}
          label={library.name}
          onPress={() => {
            setSelectedLibraryId(library.id);
            setLibraryTab('Discover');
            setOverlay(null);
          }}
          platform={platform}
          selected={library.id === selectedLibraryId}
        />
      ))}
    </ScrollView>
  );
}

function FilterOptions({platform}: {platform: PrototypePlatform}) {
  const {
    libraryFilters,
    libraryTab,
    selectedLibraryId,
    setFiltersEnabled,
    setLibraryFilters,
    setOverlay,
  } = usePrototypeUi();
  const catalog = useLibraryCatalog(selectedLibraryId);
  const library =
    catalog.data?.libraries.find(
      candidate => candidate.id === selectedLibraryId,
    ) ?? catalog.data?.libraries[0];
  const tab =
    library?.tabs.find(
      candidate =>
        candidate.label === libraryTab || candidate.id === libraryTab,
    ) ?? library?.tabs[0];
  // Every client exposes the server's complete applicable field/value set.
  // Native clients stay calm by editing one predicate at a time; they do not
  // expose the web-only nested expression builder.
  const fields = (library?.fields ?? []).filter(
    field =>
      !field.applicableKinds?.length ||
      field.applicableKinds.some(kind => tab?.entityKinds.includes(kind)),
  );
  const [draft, setDraft] =
    React.useState<LibraryFilterPredicate[]>(libraryFilters);
  const [clearRevision, setClearRevision] = React.useState(0);
  const setField = (
    field: ConnectedLibrary['fields'][number],
    value: LibraryFilterPredicate['value'] | undefined,
  ) => {
    setDraft(current => {
      const without = current.filter(predicate => predicate.field !== field.id);
      if (value === undefined || value === '') return without;
      return [
        ...without,
        {field: field.id, operator: preferredOperator(field), value},
      ];
    });
  };
  return (
    <ScrollView
      contentContainerStyle={styles.options}
      showsVerticalScrollIndicator={false}
    >
      {fields.map((field, index) => {
        const selected = draft.find(predicate => predicate.field === field.id);
        const sectionChanged =
          index === 0 || fields[index - 1]?.complexity !== field.complexity;
        return (
          <View key={field.id}>
            {sectionChanged ? (
              <Text
                style={
                  platform === 'tv'
                    ? styles.filterSectionTv
                    : styles.filterSectionMobile
                }
              >
                {field.complexity}
              </Text>
            ) : null}
            {field.controlHint === 'toggle' ? (
              <OptionRow
                description={
                  field.cost === 'indexed-join'
                    ? 'May take a little longer on large libraries'
                    : undefined
                }
                icon="action.filter"
                label={field.label}
                onPress={() =>
                  setField(field, selected ? undefined : toggleValue(field))
                }
                platform={platform}
                selected={Boolean(selected)}
              />
            ) : field.allowedValues?.length ? (
              <View style={styles.filterField}>
                <Text
                  style={
                    platform === 'tv'
                      ? styles.optionLabelTv
                      : styles.optionLabelMobile
                  }
                >
                  {field.label}
                </Text>
                <View style={styles.filterValues}>
                  {field.allowedValues.map(value => (
                    <ControlButton
                      compact
                      key={value}
                      label={humanize(value)}
                      onPress={() =>
                        setField(
                          field,
                          selected?.value === value ? undefined : value,
                        )
                      }
                      platform={platform}
                      selected={selected?.value === value}
                    />
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.filterField}>
                <Text
                  style={
                    platform === 'tv'
                      ? styles.optionLabelTv
                      : styles.optionLabelMobile
                  }
                >
                  {field.label}
                </Text>
                <TextInput
                  accessibilityLabel={`Filter by ${field.label}`}
                  defaultValue={
                    selected?.value === undefined
                      ? ''
                      : Array.isArray(selected.value)
                        ? selected.value.join(', ')
                        : String(selected.value)
                  }
                  keyboardType={
                    field.controlHint === 'number-range' ? 'numeric' : 'default'
                  }
                  key={`${field.id}-${clearRevision}`}
                  onChangeText={value =>
                    setField(field, rangeValue(field, value))
                  }
                  placeholder={
                    field.controlHint === 'date-range'
                      ? 'YYYY-MM-DD, YYYY-MM-DD'
                      : field.controlHint === 'number-range'
                        ? 'Minimum, maximum'
                        : `Enter ${field.label.toLowerCase()}`
                  }
                  placeholderTextColor={color.mutedSilver}
                  style={
                    platform === 'tv'
                      ? styles.filterInputTv
                      : styles.filterInputMobile
                  }
                />
              </View>
            )}
          </View>
        );
      })}
      {!fields.length ? (
        <Text style={platform === 'tv' ? styles.helperTv : styles.helperMobile}>
          No filters available
        </Text>
      ) : null}
      <View style={styles.optionActions}>
        <ControlButton
          label="Clear"
          onPress={() => {
            setDraft([]);
            setClearRevision(value => value + 1);
          }}
          platform={platform}
        />
        <ControlButton
          label={productText('action.apply')}
          onPress={() => {
            setLibraryFilters(draft);
            setFiltersEnabled(draft.length > 0);
            setOverlay(null);
          }}
          platform={platform}
          primary
        />
      </View>
    </ScrollView>
  );
}

function SortOptions({platform}: {platform: PrototypePlatform}) {
  const {
    libraryTab,
    selectedLibraryId,
    setOverlay,
    setSort,
    setSortDirection,
    sort,
    sortDirection,
  } = usePrototypeUi();
  const catalog = useLibraryCatalog(selectedLibraryId);
  const library =
    catalog.data?.libraries.find(
      candidate => candidate.id === selectedLibraryId,
    ) ?? catalog.data?.libraries[0];
  const tab =
    library?.tabs.find(
      candidate =>
        candidate.label === libraryTab || candidate.id === libraryTab,
    ) ?? library?.tabs[0];
  const sorts = library && tab ? availableSorts(library, tab) : [];
  const [draftSort, setDraftSort] = React.useState(sort);
  const selectedSort = sorts.find(value => value.label === draftSort);
  const [draftDirection, setDraftDirection] = React.useState<'asc' | 'desc'>(
    sortDirection,
  );
  return (
    <View style={styles.options}>
      {sorts.map(value => (
        <OptionRow
          icon="action.sort"
          key={value.id}
          label={value.label}
          onPress={() => {
            setDraftSort(value.label);
            if (!value.directions.includes(draftDirection))
              setDraftDirection(value.defaultDirection);
          }}
          platform={platform}
          selected={value.label === draftSort}
        />
      ))}
      {!sorts.length ? (
        <Text style={platform === 'tv' ? styles.helperTv : styles.helperMobile}>
          No sorting options available
        </Text>
      ) : null}
      {selectedSort ? (
        <View style={styles.filterValues}>
          {selectedSort.directions.map(direction => (
            <ControlButton
              compact
              key={direction}
              label={productText(
                direction === 'asc'
                  ? 'search.order-ascending'
                  : 'search.order-descending',
              )}
              onPress={() => setDraftDirection(direction)}
              platform={platform}
              selected={direction === draftDirection}
            />
          ))}
        </View>
      ) : null}
      {sorts.length ? (
        <View style={styles.optionActions}>
          <ControlButton
            label={productText('action.cancel')}
            onPress={() => setOverlay(null)}
            platform={platform}
          />
          <ControlButton
            label={productText('action.apply')}
            onPress={() => {
              setSort(draftSort);
              setSortDirection(draftDirection);
              setOverlay(null);
            }}
            platform={platform}
            primary
          />
        </View>
      ) : null}
    </View>
  );
}

function preferredOperator(field: ConnectedLibrary['fields'][number]): string {
  return field.operators.includes('equals')
    ? 'equals'
    : field.operators.includes('contains')
      ? 'contains'
      : (field.operators[0] ?? 'equals');
}

function toggleValue(
  field: ConnectedLibrary['fields'][number],
): LibraryFilterPredicate['value'] {
  if (field.id === 'playState')
    return field.allowedValues?.includes('unplayed') ? 'unplayed' : true;
  return field.allowedValues?.[0] ?? true;
}

function rangeValue(
  field: ConnectedLibrary['fields'][number],
  value: string,
): LibraryFilterPredicate['value'] | undefined {
  if (
    field.controlHint !== 'number-range' &&
    field.controlHint !== 'date-range'
  )
    return value;
  const parts = value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  if (field.controlHint === 'number-range')
    return parts.map(part => Number(part)).filter(Number.isFinite);
  return parts;
}

function humanize(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function ViewOptions({platform}: {platform: PrototypePlatform}) {
  const {libraryTab, selectedLibraryId, setOverlay, setViewMode, viewMode} =
    usePrototypeUi();
  const catalog = useLibraryCatalog(selectedLibraryId);
  const library =
    catalog.data?.libraries.find(
      candidate => candidate.id === selectedLibraryId,
    ) ?? catalog.data?.libraries[0];
  const tab =
    library?.tabs.find(
      candidate =>
        candidate.label === libraryTab || candidate.id === libraryTab,
    ) ?? library?.tabs[0];
  const views = new Set(tab?.supportedViews ?? []);
  return (
    <View style={styles.options}>
      {views.has('grid') ? (
        <OptionRow
          icon="view.grid"
          label={productText('library.view-grid')}
          onPress={() => {
            setViewMode('grid');
            setOverlay(null);
          }}
          platform={platform}
          selected={viewMode === 'grid'}
        />
      ) : null}
      {views.has('list') ? (
        <OptionRow
          icon="view.list"
          label={productText('library.view-list')}
          onPress={() => {
            setViewMode('list');
            setOverlay(null);
          }}
          platform={platform}
          selected={viewMode === 'list'}
        />
      ) : null}
      {!views.has('grid') && !views.has('list') ? (
        <Text style={platform === 'tv' ? styles.helperTv : styles.helperMobile}>
          No view options available
        </Text>
      ) : null}
    </View>
  );
}

function ProfileOptions({
  abandonFocus,
  platform,
}: {
  abandonFocus(): void;
  platform: PrototypePlatform;
}) {
  const auth = usePorticoAuth();
  const engagement = useEngagement();
  const {setOverlay} = usePrototypeUi();
  const {openSettings} = usePorticoNavigationActions();
  const name =
    auth.session?.displayName ?? auth.account?.username ?? 'Portico user';
  const serverName = auth.session?.serverName ?? auth.selectedServer?.name;
  const description = serverName
    ? `${serverName} · ${auth.session ? productText('settings.value.connected') : productText('settings.value.unavailable')}`
    : 'No server selected';
  const switchableServers = auth.availableServers.filter(
    server => server.id !== auth.session?.serverId,
  );
  return (
    <View style={styles.options}>
      <View style={styles.profileSummary}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(name)}</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text
            style={
              platform === 'tv'
                ? styles.profileNameTv
                : styles.profileNameMobile
            }
          >
            {name}
          </Text>
          <Text
            style={
              platform === 'tv'
                ? styles.profileServerTv
                : styles.profileServerMobile
            }
          >
            {description}
          </Text>
        </View>
      </View>
      {platform !== 'tv' ? (
        <OptionRow
          description={
            engagement.unreadCount > 0
              ? productText('notification.unread-label', {
                  count: engagement.unreadCount,
                })
              : 'No unread notifications'
          }
          icon="communication.inbox"
          label={productText('notification.title')}
          onPress={() => {
            abandonFocus();
            setOverlay(null);
            engagement.openNotifications();
          }}
          platform={platform}
        />
      ) : null}
      {auth.availableProfiles.length > 1 ? (
        <OptionRow
          description="Choose who is watching"
          icon="account.profiles"
          label="Switch profile"
          onPress={() => {
            abandonFocus();
            setOverlay(null);
            auth.beginProfileSelection().catch(() => undefined);
          }}
          platform={platform}
        />
      ) : null}
      {switchableServers.map(server => (
        <OptionRow
          description="Available to this Portico Account"
          icon="action.switch-server"
          key={server.id}
          label={`Switch to ${server.name}`}
          onPress={() => {
            abandonFocus();
            setOverlay(null);
            auth.chooseServer(server).catch(() => undefined);
          }}
          platform={platform}
        />
      ))}
      {auth.account && auth.serverError ? (
        <OptionRow
          description={auth.serverError}
          icon="action.retry"
          label="Retry server connection"
          onPress={() => {
            setOverlay(null);
            auth.retryServerDiscovery().catch(() => undefined);
          }}
          platform={platform}
        />
      ) : null}
      <OptionRow
        icon="navigation.settings"
        label={productText('settings.title')}
        onPress={() => {
          abandonFocus();
          setOverlay(null);
          openSettings();
        }}
        platform={platform}
      />
      <OptionRow
        icon="account.sign-out"
        label={productText('action.sign-out')}
        onPress={() => {
          abandonFocus();
          setOverlay(null);
          auth.signOut().catch(() => undefined);
        }}
        platform={platform}
      />
    </View>
  );
}

function CastOptions({platform}: {platform: PrototypePlatform}) {
  const auth = usePorticoAuth();
  const [nearbySetups, setNearbySetups] = React.useState<
    readonly NearbyPorticoSetupDevice[]
  >([]);
  const [authorizingId, setAuthorizingId] = React.useState<string>();
  const [authorizedId, setAuthorizedId] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const [googleCast, setGoogleCast] = React.useState<GoogleCastState>();
  React.useEffect(
    () =>
      platform === 'tv'
        ? undefined
        : subscribeToNearbyTVSetups(setNearbySetups),
    [platform],
  );
  React.useEffect(
    () =>
      platform === 'tv' ? undefined : subscribeToGoogleCastState(setGoogleCast),
    [platform],
  );
  if (platform === 'tv') return null;
  const authorize = async (device: NearbyPorticoSetupDevice) => {
    const serverId = auth.session?.serverId ?? auth.selectedServer?.id;
    if (!serverId) {
      setError(productMessageText('problem.invalid-request'));
      return;
    }
    setAuthorizingId(device.id);
    setAuthorizedId(undefined);
    setError(undefined);
    try {
      await hostedClient.authorizeTVSetupGrant({
        code: device.code,
        devicePublicKey: device.devicePublicKey,
        serverId,
        setupSessionId: device.setupSessionId,
      });
      setAuthorizedId(device.id);
    } catch (cause) {
      setError(productErrorMessageId(cause, 'problem.connection-failed'));
    } finally {
      setAuthorizingId(undefined);
    }
  };
  return (
    <View style={styles.options}>
      {googleCastPlaybackSupported ? (
        <>
          <View style={styles.airPlayOption}>
            <View style={styles.optionCopy}>
              <Text style={styles.optionLabelMobile}>Google Cast</Text>
              <Text style={styles.optionDescriptionMobile}>
                {googleCast?.connected
                  ? `Connected to ${googleCast.deviceName}`
                  : 'Choose a Cast-enabled display.'}
              </Text>
            </View>
            <GoogleCastButton style={styles.googleCastPicker} />
          </View>
          <View style={styles.destinationRule} />
        </>
      ) : null}
      <View style={styles.airPlayOption}>
        <View style={styles.optionCopy}>
          <Text style={styles.optionLabelMobile}>AirPlay</Text>
          <Text style={styles.optionDescriptionMobile}>
            Choose where to play.
          </Text>
        </View>
        <AirPlayRoutePicker style={styles.airPlayPicker} />
      </View>
      <View style={styles.destinationRule} />
      <Text style={styles.helperMobile}>
        Connect a nearby Portico TV to{' '}
        {auth.session?.serverName ??
          auth.selectedServer?.name ??
          'your selected server'}
        .
      </Text>
      {nearbySetups.map(device => (
        <OptionRow
          description={
            authorizedId === device.id
              ? 'Connected. The TV is finishing setup.'
              : `Setup code ${formatTVSetupCode(device.code) ?? device.code} · ${device.platform}`
          }
          icon="device.tv"
          key={device.id}
          label={
            authorizingId === device.id
              ? `Authorizing ${device.deviceName}…`
              : device.deviceName
          }
          onPress={() => {
            if (!authorizingId && authorizedId !== device.id)
              authorize(device).catch(() => undefined);
          }}
          platform={platform}
          selected={authorizedId === device.id}
        />
      ))}
      {!nearbySetups.length ? (
        <Text style={styles.helperMobile}>No nearby Portico TVs found.</Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.castError}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function OptionRow({
  description,
  icon,
  label,
  onPress,
  platform,
  selected,
}: {
  description?: string;
  icon: PorticoIconId;
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
      style={[
        styles.option,
        television && styles.optionTv,
        selected && styles.optionSelected,
      ]}
      focusedStyle={styles.optionFocused}
      pressedStyle={styles.optionPressed}
    >
      <PorticoIcon color={selected ? color.screenBlueStrong : color.softSilver} id={icon} size={television ? 29 : 20} state={selected ? 'selected' : 'default'} />
      <View style={styles.optionCopy}>
        <Text
          style={[
            television ? styles.optionLabelTv : styles.optionLabelMobile,
            selected && styles.optionLabelSelected,
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={
              television
                ? styles.optionDescriptionTv
                : styles.optionDescriptionMobile
            }
          >
            {description}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <PorticoIcon color={color.screenBlueStrong} id="status.selected" size={television ? 28 : 20} state="selected" />
      ) : (
        <PorticoIcon color={color.mutedSilver} id="navigation.disclosure" size={television ? 28 : 20} />
      )}
    </Focusable>
  );
}

function overlayTitle(overlay: Exclude<OverlayId, null>): string {
  switch (overlay) {
    case 'library':
      return 'Choose library';
    case 'filters':
      return productText('library.filter-label');
    case 'sort':
      return productText('library.control-sort');
    case 'view':
      return 'View';
    case 'profile':
      return 'Profile and server';
    case 'cast':
      return 'Playback destination';
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0]![0]}${parts[parts.length - 1]![0]}`
      : (parts[0]?.slice(0, 2) ?? 'P')
  ).toUpperCase();
}

const styles = StyleSheet.create({
  layer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 800,
  },
  scrim: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
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
    maxHeight: '78%',
    right: 0,
  },
  panelTv: {
    borderRadius: radius.overlay,
    maxHeight: '82%',
    right: 90,
    top: 90,
    width: 720,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 68,
    paddingHorizontal: 16,
  },
  panelHeaderTv: {minHeight: 86, paddingHorizontal: 22},
  panelTitle: {color: color.silver},
  rule: {backgroundColor: color.line, height: 1},
  options: {padding: 10},
  helperMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    padding: 8,
  },
  helperTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 19,
    lineHeight: 27,
    padding: 12,
  },
  filterSectionMobile: {
    color: color.screenBlueStrong,
    fontFamily: font.demi,
    fontSize: 12,
    letterSpacing: 0.8,
    marginHorizontal: 8,
    marginTop: 10,
    textTransform: 'uppercase',
  },
  filterSectionTv: {
    color: color.screenBlueStrong,
    fontFamily: font.demi,
    fontSize: 17,
    letterSpacing: 1,
    marginHorizontal: 12,
    marginTop: 14,
    textTransform: 'uppercase',
  },
  filterField: {gap: 8, paddingHorizontal: 12, paddingVertical: 10},
  filterValues: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 6,
  },
  filterInputMobile: {
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: 7,
    borderWidth: 2,
    color: color.silver,
    fontFamily: font.regular,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  filterInputTv: {
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 3,
    color: color.silver,
    fontFamily: font.regular,
    fontSize: 21,
    minHeight: 62,
    paddingHorizontal: 16,
  },
  option: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionTv: {
    gap: 18,
    minHeight: 82,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  optionSelected: {backgroundColor: color.raisedSlate},
  optionFocused: {backgroundColor: color.brightSlate, borderColor: color.focus},
  optionPressed: {backgroundColor: color.recess},
  optionCopy: {flex: 1},
  optionLabelMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 15,
    lineHeight: 20,
  },
  optionLabelTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 22,
    lineHeight: 28,
  },
  optionLabelSelected: {color: color.screenBlueStrong},
  optionDescriptionMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  optionDescriptionTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 17,
    lineHeight: 23,
    marginTop: 3,
  },
  airPlayOption: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  airPlayPicker: {height: 44, width: 44},
  googleCastPicker: {height: 44, width: 44},
  destinationRule: {
    backgroundColor: color.lineSoft,
    height: 1,
    marginHorizontal: 12,
    marginVertical: 4,
  },
  optionActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
    padding: 10,
  },
  castError: {
    color: color.record,
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 19,
    padding: 8,
  },
  profileSummary: {
    alignItems: 'center',
    borderBottomColor: color.lineSoft,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 14,
    marginBottom: 8,
    padding: 12,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: color.screenBlueDeep,
    borderRadius: 999,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  avatarText: {color: color.silver, fontFamily: font.bold, fontSize: 17},
  profileCopy: {flex: 1},
  profileNameMobile: {color: color.silver, fontFamily: font.demi, fontSize: 17},
  profileNameTv: {color: color.silver, fontFamily: font.demi, fontSize: 25},
  profileServerMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    marginTop: 3,
  },
  profileServerTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 18,
    marginTop: 4,
  },
  pairing: {alignItems: 'center', padding: 26},
  pairingTv: {padding: 40},
  pairingTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 17,
    marginTop: 14,
    textAlign: 'center',
  },
  pairingTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 25,
    marginTop: 20,
    textAlign: 'center',
  },
  code: {flexDirection: 'row', gap: 6, marginVertical: 24},
  codeTv: {gap: 10, marginVertical: 32},
  digitMobile: {
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 28,
    lineHeight: 38,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  digitTv: {
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 42,
    lineHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pairingStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  pairingStatusMobile: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 13,
  },
  pairingStatusTv: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 19,
  },
  codeInput: {
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 34,
    letterSpacing: 12,
    marginVertical: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    textAlign: 'center',
    width: 250,
  },
});
