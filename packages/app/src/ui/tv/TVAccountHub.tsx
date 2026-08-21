import React, {useState} from 'react';
import {Modal, StyleSheet, Text, TextInput, View} from 'react-native';
import type {PorticoIconId} from '@portico-react-native/icons';
import {
  productMessageText,
  usePorticoAuth,
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
import {color, font, tvType} from '../tokens';
import {useProfileSwitchPlaybackGuard} from '../profileSwitchPlaybackGuard';
import {TVSemanticIcon, TVSemanticIconButton} from './TVSemanticControls';

const accountMainFocusContainer = {
  id: 'account:main',
  movement: 'native',
} as const;

export type TVAccountHubStep =
  | 'hub'
  | 'profiles'
  | 'profile-pin'
  | 'profile-switch'
  | 'server'
  | 'sign-out'
  | 'security';

export function TVAccountHub() {
  const auth = usePorticoAuth();
  const navigation = usePorticoNavigationActions();
  const {setTVAccountHubOpen, tvAccountHubOpen} = usePrototypeUi();
  const [step, setStep] = useState<TVAccountHubStep>('hub');
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [pin, setPin] = useState('');
  const focus = useTVModalFocusRestoration(tvAccountHubOpen);
  const profileSwitch = useProfileSwitchPlaybackGuard();
  const close = () => {
    profileSwitch.cancel();
    setSelectedProfileId(undefined);
    setPin('');
    setStep('hub');
    setTVAccountHubOpen(false);
  };
  if (!tvAccountHubOpen) return null;
  const profile =
    auth.session?.displayName ?? auth.account?.username ?? 'Portico user';
  const server =
    auth.session?.serverName ??
    auth.selectedServer?.name ??
    'No server selected';
  const selectedProfile = auth.availableProfiles.find(
    candidate => candidate.id === selectedProfileId,
  );
  const switchProfile = (profileId: string, profilePIN?: string) => {
    const needsConfirmation = profileSwitch.request(() => {
      void auth
        .chooseProfile(profileId, profilePIN)
        .then(() => {
          focus.abandon();
          close();
        })
        .catch(() => {
          setStep(profilePIN ? 'profile-pin' : 'profiles');
        });
    });
    if (needsConfirmation) setStep('profile-switch');
  };
  return (
    <Modal
      animationType="fade"
      onDismiss={focus.onDismiss}
      onRequestClose={() => {
        if (step === 'hub') close();
        else {
          if (step === 'profile-switch') profileSwitch.cancel();
          setStep('hub');
        }
      }}
      presentationStyle="fullScreen"
      visible
    >
      <View style={styles.canvas} testID="portico-tv-account-hub">
        <TVLogicalFocusContainerBoundary container={accountMainFocusContainer}>
          <TVModalFocusTrap platform="tv" style={styles.content}>
            <View style={styles.header}>
              <View>
                <Text style={tvType.title}>{profile}</Text>
                <Text style={styles.subtitle}>{server}</Text>
              </View>
              <TVSemanticIconButton
                id="action.close"
                label={productMessageText('action.close')}
                onPress={close}
              />
            </View>
            {step === 'hub' ? (
              <View style={styles.rows}>
                {auth.availableProfiles.length > 1 ? (
                  <HubRow
                    description="Choose who is watching"
                    icon="account.profiles"
                    label="Switch Profile"
                    onPress={() => setStep('profiles')}
                    preferred
                  />
                ) : null}
                <HubRow
                  description={server}
                  icon="device.server"
                  label="Server"
                  onPress={() => setStep('server')}
                  preferred={auth.availableProfiles.length <= 1}
                />
                <HubRow
                  description="Personal and profile preferences"
                  icon="navigation.settings"
                  label="Profile Settings"
                  onPress={() => {
                    focus.abandon();
                    close();
                    navigation.openSettings('profile');
                  }}
                />
                {auth.session?.mode === 'portico-account' ? (
                  <HubRow
                    description="Continue securely on a phone or computer"
                    icon="account.security"
                    label="Account Security"
                    onPress={() => setStep('security')}
                  />
                ) : null}
                <HubRow
                  description="Sign out on this television"
                  icon="account.sign-out"
                  label={productMessageText('action.sign-out')}
                  onPress={() => setStep('sign-out')}
                  tvFocusBoundaryDirections={['down']}
                />
              </View>
            ) : null}
            {step === 'server' ? (
              <View style={styles.rows}>
                {auth.availableServers.map(candidate => (
                  <HubRow
                    description={
                      candidate.id === auth.session?.serverId
                        ? 'Connected'
                        : 'Available'
                    }
                    icon="device.server"
                    key={candidate.id}
                    label={candidate.name}
                    onPress={() => {
                      if (candidate.id === auth.session?.serverId)
                        setStep('hub');
                      else {
                        focus.abandon();
                        close();
                        void auth.chooseServer(candidate);
                      }
                    }}
                    preferred={candidate.id === auth.session?.serverId}
                  />
                ))}
                <ControlButton
                  label={productMessageText('action.back')}
                  onPress={() => setStep('hub')}
                  platform="tv"
                />
              </View>
            ) : null}
            {step === 'profiles' ? (
              <View style={styles.rows}>
                {auth.availableProfiles.map((candidate, index) => (
                  <HubRow
                    description={
                      candidate.hasPIN
                        ? 'PIN required'
                        : candidate.id === auth.session?.viewerScope.profileId
                          ? 'Current profile'
                          : 'Available'
                    }
                    icon={
                      candidate.hasPIN ? 'status.locked' : 'account.profile'
                    }
                    key={candidate.id}
                    label={candidate.name}
                    onPress={() => {
                      if (
                        candidate.id === auth.session?.viewerScope.profileId
                      ) {
                        setStep('hub');
                        return;
                      }
                      if (candidate.hasPIN) {
                        setSelectedProfileId(candidate.id);
                        setPin('');
                        setStep('profile-pin');
                      } else switchProfile(candidate.id);
                    }}
                    preferred={
                      candidate.id === auth.session?.viewerScope.profileId ||
                      index === 0
                    }
                  />
                ))}
                <ControlButton
                  label={productMessageText('action.back')}
                  onPress={() => setStep('hub')}
                  platform="tv"
                />
              </View>
            ) : null}
            {step === 'profile-pin' && selectedProfile ? (
              <View style={styles.confirmation}>
                <Text style={tvType.section}>Open {selectedProfile.name}</Text>
                <TextInput
                  accessibilityLabel={`${selectedProfile.name} PIN`}
                  autoFocus
                  keyboardType="number-pad"
                  maxLength={4}
                  onChangeText={value =>
                    setPin(value.replace(/\D/g, '').slice(0, 4))
                  }
                  placeholder="PIN"
                  placeholderTextColor={color.mutedSilver}
                  secureTextEntry
                  style={styles.pin}
                  value={pin}
                />
                <View style={styles.actions}>
                  <ControlButton
                    label={productMessageText('action.back')}
                    onPress={() => {
                      setPin('');
                      setStep('profiles');
                    }}
                    platform="tv"
                  />
                  <ControlButton
                    disabled={!/^\d{4}$/.test(pin)}
                    label={productMessageText('action.open-profile')}
                    onPress={() => switchProfile(selectedProfile.id, pin)}
                    platform="tv"
                    primary
                  />
                </View>
              </View>
            ) : null}
            {step === 'security' ? (
              <View style={styles.confirmation}>
                <Text style={tvType.section}>Continue on another device</Text>
                <Text style={styles.body}>
                  Open app.getportico.tv/settings/account on a phone or
                  computer. This TV never displays account credentials.
                </Text>
                <ControlButton
                  label={productMessageText('action.done')}
                  onPress={() => setStep('hub')}
                  platform="tv"
                  primary
                  requestInitialTVFocus
                />
              </View>
            ) : null}
            {step === 'profile-switch' ? (
              <View style={styles.confirmation}>
                <Text style={tvType.section}>Stop background audio?</Text>
                <Text style={styles.body}>
                  Switching profiles will stop the current audio session.
                </Text>
                <View style={styles.actions}>
                  <ControlButton
                    label={productMessageText('action.cancel')}
                    onPress={() => {
                      profileSwitch.cancel();
                      setStep('hub');
                    }}
                    platform="tv"
                    requestInitialTVFocus
                  />
                  <ControlButton
                    label="Stop and switch"
                    onPress={profileSwitch.confirm}
                    platform="tv"
                    primary
                  />
                </View>
              </View>
            ) : null}
            {step === 'sign-out' ? (
              <View style={styles.confirmation}>
                <Text style={tvType.section}>Sign out of this TV?</Text>
                <Text style={styles.body}>
                  Profiles and server access for this account will be removed
                  from this television.
                </Text>
                <View style={styles.actions}>
                  <ControlButton
                    label={productMessageText('action.cancel')}
                    onPress={() => setStep('hub')}
                    platform="tv"
                    requestInitialTVFocus
                  />
                  <ControlButton
                    label={productMessageText('action.sign-out')}
                    onPress={() => {
                      focus.abandon();
                      close();
                      void auth.signOut();
                    }}
                    platform="tv"
                    primary
                  />
                </View>
              </View>
            ) : null}
          </TVModalFocusTrap>
        </TVLogicalFocusContainerBoundary>
      </View>
    </Modal>
  );
}

function HubRow({
  description,
  icon,
  label,
  onPress,
  preferred = false,
  tvFocusBoundaryDirections,
}: {
  description: string;
  icon: PorticoIconId;
  label: string;
  onPress(): void;
  preferred?: boolean;
  tvFocusBoundaryDirections?: readonly ('down' | 'left' | 'right' | 'up')[];
}) {
  return (
    <Focusable
      accessibilityLabel={`${label}. ${description}`}
      accessibilityRole="button"
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      platform="tv"
      style={styles.row}
      focusedStyle={styles.rowFocused}
      pressedStyle={styles.rowPressed}
      tvFocusBoundaryDirections={
        tvFocusBoundaryDirections ?? (preferred ? ['up'] : undefined)
      }
      tvFocusId={`account-hub:${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <TVSemanticIcon id={icon} size={30} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
    </Focusable>
  );
}

const styles = StyleSheet.create({
  canvas: {backgroundColor: color.projector, flex: 1},
  content: {flex: 1, paddingBottom: 70, paddingHorizontal: 120, paddingTop: 72},
  header: {
    alignItems: 'center',
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 26,
  },
  subtitle: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 22,
    marginTop: 7,
  },
  rows: {gap: 8, marginTop: 30, maxWidth: 1080},
  row: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 3,
    flexDirection: 'row',
    minHeight: 92,
    paddingHorizontal: 22,
  },
  rowFocused: {backgroundColor: color.brightSlate, borderColor: color.focus},
  rowPressed: {backgroundColor: color.recess},
  rowCopy: {marginLeft: 22},
  rowLabel: {color: color.silver, fontFamily: font.demi, fontSize: 25},
  rowDescription: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 19,
    marginTop: 4,
  },
  confirmation: {gap: 24, marginTop: 60, maxWidth: 900},
  body: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 24,
    lineHeight: 35,
  },
  actions: {flexDirection: 'row', gap: 16},
  pin: {
    backgroundColor: color.recess,
    borderColor: color.lineStrong,
    borderWidth: 2,
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 30,
    height: 64,
    paddingHorizontal: 18,
    width: 260,
  },
});
