import React, {useState, useSyncExternalStore} from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {PorticoIcon, type PorticoIconId} from '@portico-react-native/icons';
import {
  appleInstallationPreferences,
  productMessageText,
  UNLIMITED_DOWNLOAD_STORAGE_BYTES,
  usePorticoAuth,
  usePorticoViewerPreferences,
  type AppleViewerPreferences,
  type AppleViewerPreferenceUpdate,
  type PreferredLanguage,
  type PreferredSubtitleLanguage,
  type SeekIntervalSeconds,
} from '@portico-react-native/infrastructure';
import type {PrototypePlatform} from '../../ui-compat/contract';
import {color, font, tvType} from '../tokens';
import {
  ControlButton,
  Focusable,
  IconButton,
  TVModalFocusTrap,
  useTVModalFocusRestoration,
} from '../primitives';
import {HeaderUtilities} from '../sharedComponents';
import {usePrototypeUi} from '../uiState';
import {usePorticoNavigationActions} from '../navigation';
import {AccountSelfServiceModal} from '../account/AccountSelfServiceModal';
import {ProfileManagementModal} from '../account/ProfileManagementModal';
import {productBody, productTitle} from '../productCopy';
import {useEngagement} from '../engagement';
import {useModalAnimationType} from '../useReducedMotion';
import {
  MobileChromeScaffold,
  mobileChromeScope,
  useMobileChromeScroll,
} from '../shells';
import {
  APPLE_PLAYBACK_QUALITY_OPTIONS,
  playbackQualityLabel,
  wifiPlaybackQualityUpdate,
} from '../playbackQualitySettings';
import {useRevisionFencedMutation} from '../useRevisionFencedMutation';

export function SettingsScreen({
  initialSection,
  platform,
}: {
  initialSection?: string;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  const {back, openSearch} = usePorticoNavigationActions();
  const engagement = useEngagement();
  const auth = usePorticoAuth();
  const {onScroll, scrollY} = useMobileChromeScroll(
    mobileChromeScope(
      'settings',
      auth.session?.serverId,
      auth.session?.viewerScope.profileId,
    ),
  );
  const {setOverlay} = usePrototypeUi();
  const displayName =
    auth.session?.displayName ??
    auth.account?.username ??
    productMessageText('auth.authority.hosted');
  const serverName =
    auth.session?.serverName ??
    auth.selectedServer?.name ??
    productMessageText('settings.no-server-connected');
  const authentication = productMessageText(
    auth.session?.mode === 'local'
      ? 'auth.authority.local'
      : 'auth.authority.hosted',
  );
  const viewerPreferences = usePorticoViewerPreferences();
  const preferences = viewerPreferences.values;
  const installationPreferences = useSyncExternalStore(
    appleInstallationPreferences.subscribe,
    appleInstallationPreferences.get,
    appleInstallationPreferences.get,
  );
  const preferenceMutation = useRevisionFencedMutation(
    (changes: AppleViewerPreferenceUpdate) => viewerPreferences.update(changes),
  );
  const updateViewerPreferences = (changes: AppleViewerPreferenceUpdate) =>
    preferenceMutation.mutate(changes);
  const [choice, setChoice] = useState<PreferenceChoice>();
  const [accountOpen, setAccountOpen] = useState(false);
  const [securityHandoffOpen, setSecurityHandoffOpen] = useState(false);
  const [profileManagementOpen, setProfileManagementOpen] = useState(false);
  const scrollRef = React.useRef<ScrollView>(null);
  const sectionOffsets = React.useRef<Record<string, number>>({});
  const automaticProfile =
    viewerPreferences.documents?.accountServerInstallation.values
      .profileSelection === 'last-used';

  const captureSectionOffset = React.useCallback(
    (
      section: 'account' | 'playback' | 'downloads' | 'accessibility',
      y: number,
    ) => {
      sectionOffsets.current[section] = y;
      if (
        !initialSection ||
        normalizeSettingsSection(initialSection) !== section
      )
        return;
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({animated: false, y: Math.max(0, y - 12)}),
      );
    },
    [initialSection],
  );

  React.useEffect(() => {
    if (!initialSection) return;
    if (initialSection === 'security' && !television && auth.account) {
      setAccountOpen(true);
      return;
    }
    const section = normalizeSettingsSection(initialSection);
    const timer = setTimeout(() => {
      const y = sectionOffsets.current[section];
      if (typeof y === 'number')
        scrollRef.current?.scrollTo({animated: false, y: Math.max(0, y - 12)});
    }, 0);
    return () => clearTimeout(timer);
  }, [auth.account, initialSection, television]);

  const content = (
    <>
      {television ? (
        <HeaderUtilities
          flush
          leftContent={
            <View style={styles.screenHeading}>
              <Text style={[tvType.title, styles.screenTitle]}>
                {productMessageText('settings.title')}
              </Text>
            </View>
          }
          platform={platform}
        />
      ) : null}
      <Text
        style={television ? styles.accountLabelTv : styles.accountLabelMobile}
      >
        {displayName} · {serverName}
      </Text>
      {viewerPreferences.readStatus === 'error' ? (
        <View accessibilityRole="alert" style={styles.preferenceError}>
          <Text
            style={
              television
                ? styles.settingsDescriptionTv
                : styles.settingsDescriptionMobile
            }
          >
            {productMessageText('preferences.request-failed')}
          </Text>
          <ControlButton
            compact
            label={productMessageText('action.retry')}
            onPress={() =>
              void viewerPreferences.reload().catch(() => undefined)
            }
            platform={platform}
          />
        </View>
      ) : null}
      {preferenceMutation.pending ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          style={styles.preferenceError}
        >
          <Text
            style={
              television
                ? styles.settingsDescriptionTv
                : styles.settingsDescriptionMobile
            }
          >
            Saving preferences…
          </Text>
        </View>
      ) : null}
      {preferenceMutation.error ? (
        <View accessibilityRole="alert" style={styles.preferenceError}>
          <Text
            style={
              television
                ? styles.settingsDescriptionTv
                : styles.settingsDescriptionMobile
            }
          >
            {productMessageText('preferences.request-failed')}
          </Text>
        </View>
      ) : null}

      <View
        onLayout={event =>
          captureSectionOffset('account', event.nativeEvent.layout.y)
        }
      >
        <SettingsGroup
          platform={platform}
          title={productMessageText('settings.section.account')}
        >
          <SettingsRow
            description={authentication}
            icon="account.profile"
            label={displayName}
            onPress={() => void auth.beginProfileSelection()}
            platform={platform}
            value={productMessageText('profiles.label.profile')}
          />
          {!television && auth.session ? (
            <SettingsRow
              description={productMessageText('profiles.manage-description')}
              icon="account.profiles"
              label={productMessageText('profiles.manage-title')}
              onPress={() => setProfileManagementOpen(true)}
              platform={platform}
              value={productMessageText('navigation.manage')}
            />
          ) : null}
          <SettingsRow
            description={productMessageText(
              'settings.account.server-description',
            )}
            icon="device.server"
            label={productMessageText('settings.label.server')}
            onPress={() => setOverlay('profile')}
            platform={platform}
            value={productMessageText(
              auth.session
                ? 'settings.value.connected'
                : 'settings.value.unavailable',
            )}
          />
          <SettingsRow
            description={productMessageText(
              'profiles.selection-behavior-description',
            )}
            icon="account.profiles"
            label={productMessageText('profiles.selection-last-used')}
            onPress={() =>
              void viewerPreferences
                .updateAutomaticProfileSelection(!automaticProfile)
                .catch(() => undefined)
            }
            platform={platform}
            toggle={automaticProfile}
          />
          {television && auth.session?.mode === 'portico-account' ? (
            <SettingsRow
              description="Continue account and security changes on a phone or computer."
              icon="action.open-external"
              label="Account security"
              onPress={() => setSecurityHandoffOpen(true)}
              platform={platform}
              value="Show link"
            />
          ) : null}
          {!television &&
          auth.account &&
          auth.session?.mode === 'portico-account' ? (
            <SettingsRow
              description="Identity, password, two-factor authentication, devices, and account deletion."
              icon="account.verified"
              label={productMessageText('auth.authority.hosted')}
              onPress={() => setAccountOpen(true)}
              platform={platform}
              value={productMessageText('navigation.manage')}
            />
          ) : null}
          <SettingsRow
            description="Send a private message or report a problem to this server's owner."
            icon="action.feedback"
            label={productMessageText('feedback.category.message-owner')}
            onPress={() => engagement.openFeedback({initialKind: 'general'})}
            platform={platform}
          />
        </SettingsGroup>
      </View>
      <View
        onLayout={event =>
          captureSectionOffset('playback', event.nativeEvent.layout.y)
        }
      >
        <SettingsGroup
          platform={platform}
          title={productMessageText('settings.section.playback')}
        >
          <SettingsRow
            description={productMessageText(
              'preferences.playback-autoplay-description',
            )}
            icon="playback.autoplay"
            label={productMessageText('preferences.playback-autoplay-label')}
            onPress={() =>
              updateViewerPreferences({autoplayNext: !preferences.autoplayNext})
            }
            platform={platform}
            toggle={preferences.autoplayNext}
          />
          <SettingsRow
            description={productMessageText('preferences.up-next-description')}
            icon="playback.up-next"
            label={productMessageText('preferences.up-next-label')}
            onPress={() => setChoice('upnext')}
            platform={platform}
            value={
              preferences.upNextCountdownSeconds === 0
                ? productMessageText('preferences.option-off')
                : productMessageText('preferences.seconds-option', {
                    seconds: preferences.upNextCountdownSeconds,
                  })
            }
          />
          <SettingsRow
            description={productBody('playback.still-watching')}
            icon="status.secure"
            label={productTitle('playback.still-watching')}
            onPress={() =>
              updateViewerPreferences({
                passoutProtection: !preferences.passoutProtection,
              })
            }
            platform={platform}
            toggle={preferences.passoutProtection}
          />
          <SettingsRow
            description={productMessageText(
              'preferences.seek-interval-description',
            )}
            icon="preference.seek-interval"
            label={productMessageText('preferences.seek-interval-label')}
            onPress={() => setChoice('seek')}
            platform={platform}
            value={productMessageText('preferences.seconds-option', {
              seconds: preferences.seekIntervalSeconds,
            })}
          />
          <SettingsRow
            description={productMessageText(
              'preferences.personal-playback-audio-description',
            )}
            icon="playback.language"
            label={productMessageText(
              'preferences.personal-playback-audio-label',
            )}
            onPress={() => setChoice('audio')}
            platform={platform}
            value={audioLabel(preferences.preferredAudioLanguage)}
          />
          <SettingsRow
            description={productMessageText(
              'preferences.personal-playback-subtitles-description',
            )}
            icon="playback.captions"
            label={productMessageText(
              'preferences.personal-playback-subtitles-label',
            )}
            onPress={() => setChoice('subtitles')}
            platform={platform}
            value={subtitleLabel(preferences.preferredSubtitleLanguage)}
          />
          {!television ? (
            <SettingsRow
              description={productMessageText(
                'preferences.cellular-streaming-description',
              )}
              icon="device.wifi"
              label={productMessageText('preferences.cellular-streaming-label')}
              onPress={() =>
                updateViewerPreferences({
                  allowCellularStreaming: !preferences.allowCellularStreaming,
                })
              }
              platform={platform}
              toggle={preferences.allowCellularStreaming}
            />
          ) : null}
          <SettingsRow
            description={productMessageText(
              'preferences.playback-quality-description',
            )}
            icon="playback.quality"
            label={productMessageText('preferences.playback-quality-label')}
            onPress={() => setChoice('quality')}
            platform={platform}
            value={playbackQualityLabel(
              television
                ? preferences.localQualityMode
                : preferences.wifiQualityMode,
            )}
          />
        </SettingsGroup>
      </View>

      {!television ? (
        <View
          onLayout={event =>
            captureSectionOffset('downloads', event.nativeEvent.layout.y)
          }
        >
          <SettingsGroup
            platform={platform}
            title={productMessageText('settings.section.downloads')}
          >
            <SettingsRow
              description={productMessageText(
                'preferences.download-wifi-only-description',
              )}
              icon="device.wifi"
              label={productMessageText('preferences.download-wifi-only-label')}
              onPress={() =>
                appleInstallationPreferences.update({
                  downloadsWifiOnly: !installationPreferences.downloadsWifiOnly,
                })
              }
              platform={platform}
              toggle={installationPreferences.downloadsWifiOnly}
            />
            <SettingsRow
              description={productMessageText(
                'preferences.download-storage-limit-description',
              )}
              icon="preference.storage"
              label={productMessageText(
                'preferences.download-storage-limit-label',
              )}
              onPress={() => setChoice('download-storage')}
              platform={platform}
              value={formatStorageLimit(
                installationPreferences.downloadsStorageLimitBytes,
              )}
            />
            <SettingsRow
              description={productMessageText(
                'preferences.download-delete-watched-description',
              )}
              icon="action.delete"
              label={productMessageText(
                'preferences.download-delete-watched-label',
              )}
              onPress={() =>
                updateViewerPreferences({
                  downloadDeleteWatched: !preferences.downloadDeleteWatched,
                })
              }
              platform={platform}
              toggle={preferences.downloadDeleteWatched}
            />
            <SettingsRow
              description={productMessageText(
                'preferences.download-next-episode-description',
              )}
              icon="action.add-to-list"
              label={productMessageText(
                'preferences.download-next-episode-label',
              )}
              onPress={() =>
                appleInstallationPreferences.update({
                  downloadsAutomaticNextEpisode:
                    !installationPreferences.downloadsAutomaticNextEpisode,
                })
              }
              platform={platform}
              toggle={installationPreferences.downloadsAutomaticNextEpisode}
            />
          </SettingsGroup>
        </View>
      ) : null}

      <View
        onLayout={event =>
          captureSectionOffset('accessibility', event.nativeEvent.layout.y)
        }
      >
        <SettingsGroup
          platform={platform}
          title={productMessageText('settings.section.accessibility')}
        >
          <SettingsValueRow
            description={productMessageText(
              'preferences.accessibility-motion-description',
            )}
            icon="accessibility.universal"
            label={productMessageText('preferences.accessibility-motion-label')}
            platform={platform}
            value={productMessageText('settings.value.system-setting')}
          />
          <SettingsValueRow
            description={productMessageText(
              'preferences.accessibility-captions-description',
            )}
            icon="accessibility.captions"
            label={productMessageText(
              'preferences.accessibility-captions-label',
            )}
            platform={platform}
            value={productMessageText('settings.value.system-setting')}
          />
        </SettingsGroup>
      </View>

      <View style={styles.signOut}>
        <ControlButton
          icon="account.sign-out"
          label={productMessageText('action.sign-out')}
          onPress={() => void auth.signOut()}
          platform={platform}
        />
      </View>
      <PreferenceChoiceModal
        choice={choice}
        installationStorageLimitBytes={
          installationPreferences.downloadsStorageLimitBytes
        }
        onClose={() => setChoice(undefined)}
        onUpdate={updateViewerPreferences}
        platform={platform}
        preferences={preferences}
      />
      <AccountSecurityHandoffModal
        onClose={() => setSecurityHandoffOpen(false)}
        visible={securityHandoffOpen}
      />
      {!television && auth.account ? (
        <AccountSelfServiceModal
          account={auth.account}
          auth={auth}
          onClose={() => setAccountOpen(false)}
          visible={accountOpen}
        />
      ) : null}
      {!television ? (
        <ProfileManagementModal
          onClose={() => setProfileManagementOpen(false)}
          visible={profileManagementOpen}
        />
      ) : null}
    </>
  );
  if (television)
    return (
      <ScrollView
        contentContainerStyle={styles.pageTv}
        showsVerticalScrollIndicator={false}
        testID="portico-four-settings-tv"
      >
        {content}
      </ScrollView>
    );
  return (
    <MobileChromeScaffold
      header={
        <HeaderUtilities
          flush
          leftContent={
            <View style={styles.screenHeading}>
              <IconButton
                icon="navigation.back"
                label={productMessageText('action.back')}
                onPress={back}
                platform="mobile"
              />
              <Text style={[styles.screenTitle, styles.mobileSettingsTitle]}>
                {productMessageText('settings.title')}
              </Text>
            </View>
          }
          onSearch={openSearch}
          platform="mobile"
          showProfile={false}
        />
      }
      scrollY={scrollY}
      testID="portico-mobile-settings-chrome"
    >
      <ScrollView
        contentContainerStyle={styles.page}
        onScroll={onScroll}
        ref={scrollRef}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        testID="portico-four-settings-mobile"
      >
        {content}
      </ScrollView>
    </MobileChromeScaffold>
  );
}

function normalizeSettingsSection(
  value: string,
): 'account' | 'playback' | 'downloads' | 'accessibility' {
  if (
    value === 'playback' ||
    value === 'downloads' ||
    value === 'accessibility'
  )
    return value;
  return 'account';
}

const ACCOUNT_SECURITY_HANDOFF_URL =
  'https://app.getportico.tv/settings/account';

function AccountSecurityHandoffModal({
  onClose,
  visible,
}: {
  onClose(): void;
  visible: boolean;
}) {
  const animationType = useModalAnimationType();
  const modalFocus = useTVModalFocusRestoration(visible);
  if (!visible) return null;
  return (
    <Modal
      animationType={animationType}
      onDismiss={modalFocus.onDismiss}
      onRequestClose={onClose}
      transparent
      visible
    >
      <View accessibilityViewIsModal style={styles.modalBackdrop}>
        <TVModalFocusTrap
          platform="tv"
          style={[styles.modalPanel, styles.modalPanelTv]}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitleTv}>Continue on another device</Text>
            <IconButton
              icon="action.close"
              label={productMessageText('action.close')}
              onPress={onClose}
              platform="tv"
            />
          </View>
          <Text style={styles.handoffDescriptionTv}>
            On a phone or computer, open this secure link and sign in to manage
            your password, two-factor authentication, and devices.
          </Text>
          <View
            accessibilityLabel={`Account security link: ${ACCOUNT_SECURITY_HANDOFF_URL}`}
            style={styles.handoffLinkPanel}
          >
            <Text selectable style={styles.handoffLinkTv}>
              app.getportico.tv/settings/account
            </Text>
          </View>
          <Text style={styles.handoffPrivacyTv}>
            This TV does not open an account browser or display account
            credentials.
          </Text>
          <ControlButton
            label={productMessageText('action.done')}
            onPress={onClose}
            platform="tv"
            primary
            requestInitialTVFocus
          />
        </TVModalFocusTrap>
      </View>
    </Modal>
  );
}

type PreferenceChoice =
  | 'seek'
  | 'upnext'
  | 'audio'
  | 'subtitles'
  | 'quality'
  | 'download-storage'
  | undefined;

function PreferenceChoiceModal({
  choice,
  installationStorageLimitBytes,
  onClose,
  onUpdate,
  platform,
  preferences,
}: {
  choice: PreferenceChoice;
  installationStorageLimitBytes: number;
  onClose(): void;
  onUpdate(changes: AppleViewerPreferenceUpdate): Promise<boolean>;
  platform: PrototypePlatform;
  preferences: AppleViewerPreferences;
}) {
  const television = platform === 'tv';
  const animationType = useModalAnimationType();
  const modalFocus = useTVModalFocusRestoration(television && Boolean(choice));
  const [audioQuery, setAudioQuery] = useState('');
  const [customStorageGB, setCustomStorageGB] = useState('');
  if (!choice) return null;
  const title =
    choice === 'seek'
      ? productMessageText('preferences.seek-interval-label')
      : choice === 'upnext'
        ? productMessageText('preferences.up-next-label')
        : choice === 'audio'
          ? productMessageText('preferences.personal-playback-audio-label')
          : choice === 'subtitles'
            ? productMessageText(
                'preferences.personal-playback-subtitles-label',
              )
            : choice === 'quality'
              ? productMessageText('preferences.playback-quality-label')
              : productMessageText('preferences.download-storage-limit-label');
  const options: Array<{
    id: string;
    label: string;
    selected: boolean;
    select(): boolean | Promise<boolean>;
  }> =
    choice === 'seek'
      ? ([10, 15, 30] as SeekIntervalSeconds[]).map(value => ({
          id: String(value),
          label: productMessageText('preferences.seconds-option', {
            seconds: value,
          }),
          selected: preferences.seekIntervalSeconds === value,
          select: () => onUpdate({seekIntervalSeconds: value}),
        }))
      : choice === 'upnext'
        ? ([0, 5, 10, 15] as const).map(value => ({
            id: String(value),
            label:
              value === 0
                ? productMessageText('preferences.option-off')
                : productMessageText('preferences.seconds-option', {
                    seconds: value,
                  }),
            selected: preferences.upNextCountdownSeconds === value,
            select: () => onUpdate({upNextCountdownSeconds: value}),
          }))
        : choice === 'audio'
          ? AUDIO_LANGUAGE_OPTIONS.filter(option =>
              option.label
                .toLowerCase()
                .includes(audioQuery.trim().toLowerCase()),
            ).map(option => ({
              id: option.value,
              label: option.label,
              selected: preferences.preferredAudioLanguage === option.value,
              select: () => onUpdate({preferredAudioLanguage: option.value}),
            }))
          : choice === 'subtitles'
            ? (['off', 'en', 'fr', 'es'] as PreferredSubtitleLanguage[]).map(
                value => ({
                  id: value,
                  label: subtitleLabel(value),
                  selected: preferences.preferredSubtitleLanguage === value,
                  select: () => onUpdate({preferredSubtitleLanguage: value}),
                }),
              )
            : choice === 'quality'
              ? APPLE_PLAYBACK_QUALITY_OPTIONS.map(value => ({
                  id: value,
                  label: playbackQualityLabel(value),
                  selected:
                    (television
                      ? preferences.localQualityMode
                      : preferences.wifiQualityMode) === value,
                  select: () =>
                    onUpdate(
                      television
                        ? {localQualityMode: value}
                        : wifiPlaybackQualityUpdate(value),
                    ),
                }))
              : ([5, 10, 20, 50, 100] as const).map(value => {
                  const bytes = value * 1024 * 1024 * 1024;
                  return {
                    id: String(value),
                    label: `${value} GB`,
                    selected: installationStorageLimitBytes === bytes,
                    select: () => {
                      appleInstallationPreferences.update({
                        downloadsStorageLimitBytes: bytes,
                      });
                      return true;
                    },
                  };
                });
  const storageOptions =
    choice === 'download-storage'
      ? [
          {
            id: 'unlimited',
            label: 'Unlimited',
            selected:
              installationStorageLimitBytes ===
              UNLIMITED_DOWNLOAD_STORAGE_BYTES,
            select: () => {
              appleInstallationPreferences.update({
                downloadsStorageLimitBytes: UNLIMITED_DOWNLOAD_STORAGE_BYTES,
              });
              return true;
            },
          },
          ...options,
        ]
      : options;
  const visibleOptions =
    choice === 'download-storage' ? storageOptions : options;
  return (
    <Modal
      animationType={animationType}
      onDismiss={modalFocus.onDismiss}
      onRequestClose={onClose}
      transparent
      visible
    >
      <View accessibilityViewIsModal style={styles.modalBackdrop}>
        <TVModalFocusTrap
          platform={platform}
          style={[styles.modalPanel, television && styles.modalPanelTv]}
        >
          <View style={styles.modalHeader}>
            <Text
              style={television ? styles.modalTitleTv : styles.modalTitleMobile}
            >
              {title}
            </Text>
            <IconButton
              icon="action.close"
              label={productMessageText('action.close')}
              onPress={onClose}
              platform={platform}
            />
          </View>
          {choice === 'audio' ? (
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setAudioQuery}
              placeholder="Search languages"
              placeholderTextColor={color.mutedSilver}
              style={styles.modalSearch}
              value={audioQuery}
            />
          ) : null}
          <ScrollView
            contentContainerStyle={styles.modalOptions}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {visibleOptions.map(option => (
              <Focusable
                accessibilityLabel={option.label}
                accessibilityRole="radio"
                accessibilityState={{checked: option.selected}}
                hasTVPreferredFocus={television && option.selected}
                key={option.id}
                onPress={() => {
                  void Promise.resolve(option.select()).then(saved => {
                    if (saved) onClose();
                  });
                }}
                platform={platform}
                style={[
                  styles.modalOption,
                  television && styles.modalOptionTv,
                  option.selected && styles.modalOptionSelected,
                ]}
                focusedStyle={styles.settingsRowFocused}
                pressedStyle={styles.settingsRowPressed}
              >
                <Text
                  style={
                    television
                      ? styles.modalOptionTextTv
                      : styles.modalOptionTextMobile
                  }
                >
                  {option.label}
                </Text>
                <View style={[styles.radio, television && styles.radioTv]}>
                  {option.selected ? (
                    <View
                      style={[
                        styles.radioSelected,
                        television && styles.radioSelectedTv,
                      ]}
                    />
                  ) : null}
                </View>
              </Focusable>
            ))}
            {choice === 'download-storage' ? (
              <View style={styles.customStorage}>
                <TextInput
                  keyboardType="decimal-pad"
                  onChangeText={setCustomStorageGB}
                  placeholder="Custom limit in GB"
                  placeholderTextColor={color.mutedSilver}
                  style={styles.modalSearch}
                  value={customStorageGB}
                />
                <ControlButton
                  compact
                  disabled={
                    !Number.isFinite(Number(customStorageGB)) ||
                    Number(customStorageGB) < 0.25 ||
                    Number(customStorageGB) > 10240
                  }
                  label="Use custom limit"
                  onPress={() => {
                    const gb = Number(customStorageGB);
                    if (!Number.isFinite(gb) || gb < 0.25 || gb > 10240) return;
                    appleInstallationPreferences.update({
                      downloadsStorageLimitBytes: Math.round(
                        gb * 1024 * 1024 * 1024,
                      ),
                    });
                    onClose();
                  }}
                  platform={platform}
                />
              </View>
            ) : null}
          </ScrollView>
        </TVModalFocusTrap>
      </View>
    </Modal>
  );
}

function audioLabel(value: PreferredLanguage): string {
  return value === 'original'
    ? productMessageText('preferences.option-original')
    : value === 'system'
      ? 'System language'
      : (AUDIO_LANGUAGE_OPTIONS.find(option => option.value === value)?.label ??
        value);
}

function subtitleLabel(value: PreferredSubtitleLanguage): string {
  return productMessageText(
    value === 'off'
      ? 'preferences.option-off'
      : value === 'en'
        ? 'preferences.option-english'
        : value === 'fr'
          ? 'preferences.option-french'
          : 'preferences.option-spanish',
  );
}

function formatStorageLimit(bytes: number): string {
  if (bytes === UNLIMITED_DOWNLOAD_STORAGE_BYTES) return 'Unlimited';
  const gigabytes = bytes / (1024 * 1024 * 1024);
  return `${Number.isInteger(gigabytes) ? gigabytes.toFixed(0) : gigabytes.toFixed(1)} GB`;
}

const AUDIO_LANGUAGE_OPTIONS: Array<{value: PreferredLanguage; label: string}> =
  [
    {value: 'system', label: 'System language'},
    {
      value: 'original',
      label: productMessageText('preferences.option-original'),
    },
    {value: 'en', label: 'English'},
    {value: 'fr', label: 'French'},
    {value: 'es', label: 'Spanish'},
    {value: 'de', label: 'German'},
    {value: 'it', label: 'Italian'},
    {value: 'pt', label: 'Portuguese'},
    {value: 'ja', label: 'Japanese'},
    {value: 'ko', label: 'Korean'},
    {value: 'zh', label: 'Chinese'},
    {value: 'nl', label: 'Dutch'},
    {value: 'sv', label: 'Swedish'},
    {value: 'no', label: 'Norwegian'},
    {value: 'da', label: 'Danish'},
    {value: 'pl', label: 'Polish'},
    {value: 'tr', label: 'Turkish'},
    {value: 'ru', label: 'Russian'},
  ];

function SettingsGroup({
  children,
  platform,
  title,
}: {
  children: React.ReactNode;
  platform: PrototypePlatform;
  title: string;
}) {
  const television = platform === 'tv';
  return (
    <View style={[styles.settingsGroup, television && styles.settingsGroupTv]}>
      <Text style={television ? styles.groupTitleTv : styles.groupTitleMobile}>
        {title}
      </Text>
      <View style={styles.groupRows}>{children}</View>
    </View>
  );
}

function SettingsRow({
  description,
  icon,
  label,
  onPress,
  platform,
  toggle,
  value,
}: {
  description: string;
  icon: PorticoIconId;
  label: string;
  onPress(): void;
  platform: PrototypePlatform;
  toggle?: boolean;
  value?: string;
}) {
  const television = platform === 'tv';
  const hasToggle = typeof toggle === 'boolean';
  return (
    <Focusable
      accessibilityLabel={`${label}. ${description}`}
      accessibilityRole={hasToggle ? 'switch' : 'button'}
      accessibilityState={hasToggle ? {checked: toggle} : undefined}
      onPress={onPress}
      platform={platform}
      style={[styles.settingsRow, television && styles.settingsRowTv]}
      focusedStyle={styles.settingsRowFocused}
      pressedStyle={styles.settingsRowPressed}
    >
      <PorticoIcon color={color.softSilver} id={icon} size={television ? 28 : 20} strokeWidth={1.9} />
      <View style={styles.settingsCopy}>
        <Text
          style={
            television ? styles.settingsLabelTv : styles.settingsLabelMobile
          }
        >
          {label}
        </Text>
        <Text
          style={
            television
              ? styles.settingsDescriptionTv
              : styles.settingsDescriptionMobile
          }
        >
          {description}
        </Text>
      </View>
      {hasToggle ? (
        <View
          style={[
            styles.toggle,
            television && styles.toggleTv,
            toggle && styles.toggleOn,
          ]}
        >
          <View
            style={[
              styles.toggleThumb,
              television && styles.toggleThumbTv,
              toggle && styles.toggleThumbOn,
            ]}
          />
        </View>
      ) : (
        <View style={styles.settingsValue}>
          {value ? (
            <Text style={television ? styles.valueTv : styles.valueMobile}>
              {value}
            </Text>
          ) : null}
          <PorticoIcon color={color.mutedSilver} id="navigation.disclosure" size={television ? 27 : 19} />
        </View>
      )}
    </Focusable>
  );
}

function SettingsValueRow({
  description,
  icon,
  label,
  platform,
  value,
}: {
  description: string;
  icon: PorticoIconId;
  label: string;
  platform: PrototypePlatform;
  value: string;
}) {
  const television = platform === 'tv';
  return (
    <View
      accessibilityLabel={`${label}. ${description}. ${value}`}
      style={[styles.settingsRow, television && styles.settingsRowTv]}
    >
      <PorticoIcon color={color.softSilver} id={icon} size={television ? 28 : 20} strokeWidth={1.9} />
      <View style={styles.settingsCopy}>
        <Text
          style={
            television ? styles.settingsLabelTv : styles.settingsLabelMobile
          }
        >
          {label}
        </Text>
        <Text
          style={
            television
              ? styles.settingsDescriptionTv
              : styles.settingsDescriptionMobile
          }
        >
          {description}
        </Text>
      </View>
      <Text style={television ? styles.valueTv : styles.valueMobile}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: color.projector,
    minHeight: '100%',
    paddingBottom: 80,
    paddingHorizontal: 16,
  },
  pageTv: {paddingBottom: 70, paddingLeft: 0, paddingRight: 72},
  screenHeading: {alignItems: 'center', flexDirection: 'row', gap: 12},
  mobileSettingsTitle: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 22,
    lineHeight: 28,
  },
  screenTitle: {color: color.silver},
  accountLabelMobile: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 13,
    marginBottom: 18,
  },
  accountLabelTv: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 19,
    marginBottom: 26,
  },
  preferenceError: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 18,
    padding: 12,
  },
  settingsGroup: {marginBottom: 28},
  settingsGroupTv: {marginBottom: 38},
  groupTitleMobile: {
    color: color.dimSilver,
    fontFamily: font.demi,
    fontSize: 13,
    marginBottom: 8,
  },
  groupTitleTv: {
    color: color.dimSilver,
    fontFamily: font.demi,
    fontSize: 19,
    marginBottom: 12,
  },
  groupRows: {
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderWidth: 1,
  },
  settingsRow: {
    alignItems: 'center',
    borderBottomColor: color.lineSoft,
    borderColor: color.transparent,
    borderBottomWidth: 1,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 12,
    minHeight: 70,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  settingsRowTv: {
    gap: 18,
    minHeight: 94,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  settingsRowFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  settingsRowPressed: {backgroundColor: color.brightSlate},
  settingsCopy: {flex: 1},
  settingsLabelMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 15,
    lineHeight: 20,
  },
  settingsLabelTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 22,
    lineHeight: 28,
  },
  settingsDescriptionMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  settingsDescriptionTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 17,
    lineHeight: 23,
    marginTop: 3,
  },
  settingsValue: {alignItems: 'center', flexDirection: 'row', gap: 8},
  valueMobile: {color: color.softSilver, fontFamily: font.medium, fontSize: 13},
  valueTv: {color: color.softSilver, fontFamily: font.medium, fontSize: 19},
  toggle: {
    backgroundColor: color.brightSlate,
    borderRadius: 999,
    height: 28,
    padding: 3,
    width: 48,
  },
  toggleTv: {height: 36, padding: 4, width: 62},
  toggleOn: {backgroundColor: color.screenBlueDeep},
  toggleThumb: {
    backgroundColor: color.softSilver,
    borderRadius: 999,
    height: 22,
    width: 22,
  },
  toggleThumbTv: {height: 28, width: 28},
  toggleThumbOn: {alignSelf: 'flex-end', backgroundColor: color.silver},
  signOut: {alignSelf: 'flex-start', marginTop: 4},
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,4,8,0.78)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalPanel: {
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 520,
    padding: 16,
    width: '100%',
  },
  modalPanelTv: {maxWidth: 760, padding: 24},
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 22},
  modalTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 32},
  modalOptions: {gap: 6, marginTop: 14},
  modalSearch: {
    backgroundColor: color.slate,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.regular,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  customStorage: {gap: 8, marginTop: 8},
  modalOption: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 12,
  },
  modalOptionTv: {minHeight: 74, paddingHorizontal: 18},
  modalOptionSelected: {backgroundColor: color.raisedSlate},
  modalOptionTextMobile: {
    color: color.silver,
    fontFamily: font.medium,
    fontSize: 16,
  },
  modalOptionTextTv: {
    color: color.silver,
    fontFamily: font.medium,
    fontSize: 23,
  },
  handoffDescriptionTv: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 21,
    lineHeight: 29,
    marginTop: 18,
  },
  handoffLinkPanel: {
    alignItems: 'center',
    backgroundColor: color.projector,
    borderColor: color.screenBlue,
    borderRadius: 8,
    borderWidth: 2,
    marginVertical: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  handoffLinkTv: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 28,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  handoffPrivacyTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 17,
    lineHeight: 23,
    marginBottom: 20,
  },
  radio: {
    alignItems: 'center',
    borderColor: color.softSilver,
    borderRadius: 9,
    borderWidth: 2,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  radioTv: {borderRadius: 12, height: 24, width: 24},
  radioSelected: {
    backgroundColor: color.screenBlueStrong,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  radioSelectedTv: {borderRadius: 7, height: 14, width: 14},
});
