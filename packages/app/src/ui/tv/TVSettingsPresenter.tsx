import React, {useMemo, useState} from 'react';
import {Modal, ScrollView, StyleSheet, Text, View} from 'react-native';
import type {PorticoIconId} from '@portico-react-native/icons';
import {
  productMessageText,
  usePorticoAuth,
  usePorticoViewerPreferences,
  type AppleViewerPreferenceUpdate,
  type PreferredLanguage,
  type PreferredSubtitleLanguage,
  type SeekIntervalSeconds,
} from '@portico-react-native/infrastructure';
import {
  ControlButton,
  Focusable,
  TVLogicalFocusContainerBoundary,
  TVModalFocusTrap,
  useTVModalFocusRestoration,
} from '../primitives';
import {usePorticoNavigationActions} from '../navigation';
import {usePrototypeUi} from '../uiState';
import {useRevisionFencedMutation} from '../useRevisionFencedMutation';
import {
  playbackQualityLabel,
  APPLE_PLAYBACK_QUALITY_OPTIONS,
} from '../playbackQualitySettings';
import {color, font, tvType} from '../tokens';
import {TVSemanticIcon, TVSemanticIconButton} from './TVSemanticControls';

export type TVSettingsSectionId =
  | 'profile'
  | 'playback'
  | 'device'
  | 'accessibility';
export type TVSettingsChoice =
  | 'audio'
  | 'quality'
  | 'seek'
  | 'subtitles'
  | 'upnext';
const settingsMainContainer = {
  id: 'settings:main',
  movement: 'native',
} as const;
const settingsChoiceContainer = {
  id: 'settings:choice',
  movement: 'native',
} as const;

export function tvSettingsInitialSection(value?: string): TVSettingsSectionId {
  if (value === 'profile' || value === 'device' || value === 'accessibility')
    return value;
  return 'playback';
}

export function TVSettingsPresenter({
  initialSection,
}: {
  initialSection?: string;
}) {
  const auth = usePorticoAuth();
  const navigation = usePorticoNavigationActions();
  const viewer = usePorticoViewerPreferences();
  const {setTVAccountHubOpen} = usePrototypeUi();
  const mutation = useRevisionFencedMutation(
    (changes: AppleViewerPreferenceUpdate) => viewer.update(changes),
  );
  const [choice, setChoice] = useState<TVSettingsChoice>();
  const initial = tvSettingsInitialSection(initialSection);
  const personalOnly = initial === 'profile';
  const automaticProfile =
    viewer.documents?.accountServerInstallation.values.profileSelection ===
    'last-used';
  const update = (changes: AppleViewerPreferenceUpdate) =>
    void mutation.mutate(changes);
  return (
    <View style={styles.screen} testID="portico-tv-settings-native">
      <View style={styles.header}>
        <Text style={tvType.title}>
          {personalOnly
            ? 'Profile Settings'
            : productMessageText('settings.title')}
        </Text>
        <TVSemanticIconButton
          id="action.close"
          label={productMessageText('action.back')}
          onPress={navigation.back}
        />
      </View>
      {viewer.readStatus === 'loading' ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          Refreshing settings…
        </Text>
      ) : null}
      {viewer.readStatus === 'error' ? (
        <View style={styles.statusRow}>
          <Text accessibilityRole="alert" style={styles.status}>
            {productMessageText('preferences.request-failed')}
          </Text>
          <ControlButton
            compact
            label={productMessageText('action.retry')}
            onPress={() => void viewer.reload()}
            platform="tv"
          />
        </View>
      ) : null}
      {viewer.mutationStatus === 'saving' || mutation.pending ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          Saving…
        </Text>
      ) : null}
      {viewer.mutationStatus === 'error' || mutation.error ? (
        <Text accessibilityRole="alert" style={styles.status}>
          {productMessageText('preferences.request-failed')}
        </Text>
      ) : null}
      <TVLogicalFocusContainerBoundary container={settingsMainContainer}>
        <ScrollView
          contentContainerStyle={styles.page}
          showsVerticalScrollIndicator={false}
        >
          {personalOnly ? (
            <SettingsSection title="Profile">
              <TVSettingRow
                description="Choose who is watching and manage the active server"
                icon="account.profile"
                label={auth.session?.displayName ?? 'Profile'}
                onPress={() => setTVAccountHubOpen(true)}
                preferred
              />
              <TVSettingRow
                description={productMessageText(
                  'profiles.selection-behavior-description',
                )}
                icon="account.profiles"
                label={productMessageText('profiles.selection-last-used')}
                onPress={() =>
                  void viewer.updateAutomaticProfileSelection(!automaticProfile)
                }
                toggle={automaticProfile}
              />
              <TVSettingRow
                description={productMessageText(
                  'preferences.personal-playback-audio-description',
                )}
                icon="playback.language"
                label={productMessageText(
                  'preferences.personal-playback-audio-label',
                )}
                onPress={() => setChoice('audio')}
                value={audioLabel(viewer.values.preferredAudioLanguage)}
              />
              <TVSettingRow
                description={productMessageText(
                  'preferences.personal-playback-subtitles-description',
                )}
                icon="playback.captions"
                label={productMessageText(
                  'preferences.personal-playback-subtitles-label',
                )}
                onPress={() => setChoice('subtitles')}
                value={subtitleLabel(viewer.values.preferredSubtitleLanguage)}
              />
            </SettingsSection>
          ) : (
            <>
              <SettingsSection
                title={productMessageText('settings.section.playback')}
              >
                <TVSettingRow
                  description={productMessageText(
                    'preferences.playback-autoplay-description',
                  )}
                  icon="playback.autoplay"
                  label={productMessageText(
                    'preferences.playback-autoplay-label',
                  )}
                  onPress={() =>
                    update({autoplayNext: !viewer.values.autoplayNext})
                  }
                  preferred={initial === 'playback'}
                  toggle={viewer.values.autoplayNext}
                />
                <TVSettingRow
                  description={productMessageText(
                    'preferences.up-next-description',
                  )}
                  icon="playback.up-next"
                  label={productMessageText('preferences.up-next-label')}
                  onPress={() => setChoice('upnext')}
                  value={
                    viewer.values.upNextCountdownSeconds === 0
                      ? productMessageText('preferences.option-off')
                      : `${viewer.values.upNextCountdownSeconds} seconds`
                  }
                />
                <TVSettingRow
                  description={productMessageText(
                    'preferences.seek-interval-description',
                  )}
                  icon="playback.seek-forward"
                  label={productMessageText('preferences.seek-interval-label')}
                  onPress={() => setChoice('seek')}
                  value={`${viewer.values.seekIntervalSeconds} seconds`}
                />
                <TVSettingRow
                  description={productMessageText(
                    'preferences.playback-quality-description',
                  )}
                  icon="playback.quality"
                  label={productMessageText(
                    'preferences.playback-quality-label',
                  )}
                  onPress={() => setChoice('quality')}
                  value={playbackQualityLabel(viewer.values.localQualityMode)}
                />
              </SettingsSection>
              <SettingsSection title="App & Device">
                <TVSettingRow
                  description={
                    auth.session?.serverName ??
                    auth.selectedServer?.name ??
                    productMessageText('settings.no-server-connected')
                  }
                  icon="device.server"
                  label={productMessageText('settings.label.server')}
                  onPress={() => setTVAccountHubOpen(true)}
                  preferred={initial === 'device'}
                  value={productMessageText(
                    auth.session
                      ? 'settings.value.connected'
                      : 'settings.value.unavailable',
                  )}
                />
              </SettingsSection>
              <SettingsSection
                title={productMessageText('settings.section.accessibility')}
              >
                <TVSettingValueRow
                  description={productMessageText(
                    'preferences.accessibility-motion-description',
                  )}
                  icon="accessibility.universal"
                  label={productMessageText(
                    'preferences.accessibility-motion-label',
                  )}
                  preferred={initial === 'accessibility'}
                  value={productMessageText('settings.value.system-setting')}
                />
                <TVSettingValueRow
                  description={productMessageText(
                    'preferences.accessibility-captions-description',
                  )}
                  icon="accessibility.captions"
                  label={productMessageText(
                    'preferences.accessibility-captions-label',
                  )}
                  value={productMessageText('settings.value.system-setting')}
                />
              </SettingsSection>
            </>
          )}
        </ScrollView>
      </TVLogicalFocusContainerBoundary>
      <TVSettingsChoiceSurface
        choice={choice}
        close={() => setChoice(undefined)}
        update={update}
        values={viewer.values}
      />
    </View>
  );
}

function SettingsSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.rows}>{children}</View>
    </View>
  );
}

function TVSettingRow({
  description,
  icon,
  label,
  onPress,
  preferred,
  toggle,
  value,
}: {
  description: string;
  icon: PorticoIconId;
  label: string;
  onPress(): void;
  preferred?: boolean;
  toggle?: boolean;
  value?: string;
}) {
  return (
    <Focusable
      accessibilityLabel={`${label}. ${value ?? description}`}
      accessibilityRole="button"
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      platform="tv"
      style={styles.row}
      focusedStyle={styles.rowFocused}
      pressedStyle={styles.rowPressed}
      tvFocusBoundaryDirections={preferred ? ['up'] : undefined}
      tvFocusId={`settings:${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <TVSemanticIcon id={icon} />
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text numberOfLines={1} style={styles.description}>
          {description}
        </Text>
      </View>
      <Text style={styles.value}>
        {toggle === undefined
          ? value
          : toggle
            ? 'On'
            : productMessageText('preferences.option-off')}
      </Text>
    </Focusable>
  );
}

function TVSettingValueRow({
  description,
  icon,
  label,
  preferred,
  value,
}: {
  description: string;
  icon: PorticoIconId;
  label: string;
  preferred?: boolean;
  value: string;
}) {
  return (
    <Focusable
      accessibilityLabel={`${label}. ${value}. ${description}`}
      accessibilityRole="text"
      hasTVPreferredFocus={preferred}
      platform="tv"
      style={styles.row}
      focusedStyle={styles.rowFocused}
    >
      <TVSemanticIcon id={icon} />
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <Text style={styles.value}>{value}</Text>
    </Focusable>
  );
}

function TVSettingsChoiceSurface({
  choice,
  close,
  update,
  values,
}: {
  choice?: TVSettingsChoice;
  close(): void;
  update(changes: AppleViewerPreferenceUpdate): void;
  values: ReturnType<typeof usePorticoViewerPreferences>['values'];
}) {
  const focus = useTVModalFocusRestoration(Boolean(choice));
  const options = useMemo(
    () => choiceOptions(choice, values),
    [choice, values],
  );
  if (!choice) return null;
  const select = (changes: AppleViewerPreferenceUpdate) => {
    update(changes);
    close();
  };
  return (
    <Modal
      animationType="fade"
      onDismiss={focus.onDismiss}
      onRequestClose={close}
      presentationStyle="fullScreen"
      visible
    >
      <View style={styles.choiceCanvas}>
        <TVLogicalFocusContainerBoundary container={settingsChoiceContainer}>
          <TVModalFocusTrap platform="tv" style={styles.choiceContent}>
            <View style={styles.header}>
              <Text style={tvType.title}>{choiceTitle(choice)}</Text>
              <TVSemanticIconButton
                id="action.close"
                label={productMessageText('action.close')}
                onPress={close}
              />
            </View>
            <View style={styles.rows}>
              {options.map((option, index) => (
                <Focusable
                  accessibilityRole="radio"
                  accessibilityState={{checked: option.selected}}
                  hasTVPreferredFocus={
                    option.selected ||
                    (!options.some(candidate => candidate.selected) &&
                      index === 0)
                  }
                  key={option.id}
                  onPress={() => select(option.changes)}
                  platform="tv"
                  style={styles.row}
                  focusedStyle={styles.rowFocused}
                  tvFocusBoundaryDirections={[
                    ...(index === 0 ? ['up' as const] : []),
                    ...(index === options.length - 1 ? ['down' as const] : []),
                  ]}
                  tvFocusId={`settings-choice:${choice}:${option.id}`}
                >
                  <Text style={styles.label}>{option.label}</Text>
                  <Text style={styles.value}>
                    {option.selected ? 'Selected' : ''}
                  </Text>
                </Focusable>
              ))}
            </View>
          </TVModalFocusTrap>
        </TVLogicalFocusContainerBoundary>
      </View>
    </Modal>
  );
}

function choiceTitle(choice: TVSettingsChoice): string {
  if (choice === 'audio')
    return productMessageText('preferences.personal-playback-audio-label');
  if (choice === 'subtitles')
    return productMessageText('preferences.personal-playback-subtitles-label');
  if (choice === 'quality')
    return productMessageText('preferences.playback-quality-label');
  if (choice === 'seek')
    return productMessageText('preferences.seek-interval-label');
  return productMessageText('preferences.up-next-label');
}

function choiceOptions(
  choice: TVSettingsChoice | undefined,
  values: ReturnType<typeof usePorticoViewerPreferences>['values'],
): Array<{
  changes: AppleViewerPreferenceUpdate;
  id: string;
  label: string;
  selected: boolean;
}> {
  if (choice === 'seek')
    return ([10, 15, 30] as SeekIntervalSeconds[]).map(value => ({
      changes: {seekIntervalSeconds: value},
      id: String(value),
      label: `${value} seconds`,
      selected: values.seekIntervalSeconds === value,
    }));
  if (choice === 'upnext')
    return ([0, 5, 10, 15] as const).map(value => ({
      changes: {upNextCountdownSeconds: value},
      id: String(value),
      label: value
        ? `${value} seconds`
        : productMessageText('preferences.option-off'),
      selected: values.upNextCountdownSeconds === value,
    }));
  if (choice === 'quality')
    return APPLE_PLAYBACK_QUALITY_OPTIONS.map(value => ({
      changes: {localQualityMode: value},
      id: value,
      label: playbackQualityLabel(value),
      selected: values.localQualityMode === value,
    }));
  if (choice === 'subtitles')
    return (['off', 'en', 'fr', 'es'] as PreferredSubtitleLanguage[]).map(
      value => ({
        changes: {preferredSubtitleLanguage: value},
        id: value,
        label: subtitleLabel(value),
        selected: values.preferredSubtitleLanguage === value,
      }),
    );
  return (['original', 'system', 'en', 'fr', 'es'] as PreferredLanguage[]).map(
    value => ({
      changes: {preferredAudioLanguage: value},
      id: value,
      label: audioLabel(value),
      selected: values.preferredAudioLanguage === value,
    }),
  );
}

function audioLabel(value: PreferredLanguage): string {
  return value === 'original'
    ? 'Original'
    : value === 'system'
      ? 'System language'
      : value.toUpperCase();
}
function subtitleLabel(value: PreferredSubtitleLanguage): string {
  return value === 'off' ? 'Off' : value.toUpperCase();
}

const styles = StyleSheet.create({
  screen: {backgroundColor: color.projector, flex: 1, paddingLeft: 136},
  header: {
    alignItems: 'center',
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 54,
    paddingVertical: 30,
  },
  page: {gap: 38, paddingBottom: 80, paddingHorizontal: 54, paddingTop: 30},
  section: {gap: 14},
  sectionTitle: {color: color.silver, fontFamily: font.demi, fontSize: 28},
  rows: {gap: 7},
  row: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 3,
    flexDirection: 'row',
    minHeight: 84,
    paddingHorizontal: 20,
  },
  rowFocused: {backgroundColor: color.brightSlate, borderColor: color.focus},
  rowPressed: {backgroundColor: color.recess},
  copy: {flex: 1, marginLeft: 20},
  label: {color: color.silver, fontFamily: font.demi, fontSize: 23},
  description: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 17,
    marginTop: 3,
  },
  value: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 20,
    marginLeft: 20,
  },
  status: {color: color.softSilver, fontFamily: font.medium, fontSize: 18},
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 54,
    paddingTop: 14,
  },
  choiceCanvas: {backgroundColor: color.projector, flex: 1},
  choiceContent: {flex: 1, paddingHorizontal: 120, paddingTop: 50},
});
