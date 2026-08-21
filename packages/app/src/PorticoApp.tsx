import React, {useRef, useState} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TVFocusGuideView,
  View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {PorticoBrand, PorticoIcon} from '@portico-react-native/icons';
import {
  PorticoAuthProvider,
  authorizeNearbyTV,
  clearPorticoTopShelf,
  hostedClient,
  clientMetadataId,
  nearbyTVSetupSessionStore,
  persistNearbyTVCredentials,
  usePorticoAuth,
  formatTVSetupCode,
  isAccountCreatedSignInRequired,
  isMFARequired,
  ProductMessageError,
  productErrorMessageId,
  productMessageText,
  porticoClientDescriptor,
  subscribeToNearbyPorticoServers,
  type NearbyTVSetupDisplay,
  type PorticoPlatform,
  PorticoViewerRuntimeProvider,
  PorticoViewerPreferencesProvider,
  useViewerRuntimeSnapshot,
} from '@portico-react-native/infrastructure';
import {
  productMessage,
  resolveProductContinuity,
  validPorticoUsername,
  type NormalizedPorticoDiscoveryRecord,
} from '@porticomediaserver/client-core';
import {color, font, mobileType, tvType} from './tokens';
import {PorticoV4App} from './ui/PorticoV4App';
import {AmbientArtworkGlow, EmptyState} from './ui/primitives';
import {AccountSelfServiceModal} from './ui/account/AccountSelfServiceModal';
import {
  porticoPasswordRequirements,
  porticoPasswordStrength,
  passwordStrengthLabel,
  validPorticoPassword,
} from './ui/passwordStrength';
import {useDeferredDownloadProgressSync} from './ui/downloads';
import {useApplicationEventInvalidations} from './ui/applicationEvents';
import {safeProductCopy} from './ui/productCopy';
import {MobileNavigationApplication} from './ui/mobileNavigation';
import {applicationRootPhaseForState} from './ui/applicationRootPhase';
import {PrototypeUiProvider} from './ui/uiState';
import {MobileChromeMetricsProvider} from './ui/mobileChromeMetrics';
import {PersistentPlaybackProvider} from './ui/playbackSession';
import {TVProfileSelectionPresenter} from './ui/tv/TVProfileSelectionPresenter';

export function PorticoApp({platform}: {platform: PorticoPlatform}) {
  return (
    <SafeAreaProvider>
      <PorticoViewerRuntimeProvider>
        <PorticoAuthProvider platform={platform}>
          <PorticoViewerPreferencesProvider platform={platform}>
            <AppGate platform={platform} />
          </PorticoViewerPreferencesProvider>
        </PorticoAuthProvider>
      </PorticoViewerRuntimeProvider>
    </SafeAreaProvider>
  );
}

function AppGate({platform}: {platform: PorticoPlatform}) {
  if (platform === 'mobile') return <MobileRootGate />;
  return <TVRootGate />;
}

function TVRootGate() {
  const auth = usePorticoAuth();
  const viewerRuntime = useViewerRuntimeSnapshot();
  const product = useSignedInProductFrameState('tv');
  const client = product.connected ? auth.session?.client : undefined;
  useApplicationEventInvalidations(client);
  const phase = applicationRootPhaseForState({
    status: auth.status,
    hasAccount: Boolean(auth.account),
    transitionFailure: Boolean(viewerRuntime.transitionFailure),
  });
  React.useEffect(() => {
    if (auth.status !== 'authenticated') void clearPorticoTopShelf();
  }, [auth.status]);
  let phaseSurface: React.ReactNode;
  if (
    phase === 'Account' &&
    (auth.status === 'booting' || auth.status === 'connecting')
  ) {
    phaseSurface = <LoadingState platform="tv" />;
  } else if (phase === 'FailClosed') {
    phaseSurface = <FailClosedRecoveryState platform="tv" />;
  } else if (phase === 'Account') {
    phaseSurface = <SignIn platform="tv" />;
  } else if (phase === 'Profile') {
    phaseSurface = <TVProfileSelectionPresenter />;
  }
  return (
    <View style={styles.authenticatedRoot}>
      <PorticoV4App
        connected={product.connected}
        connectionSurface={product.connectionSurface}
        phase={phase}
        phaseSurface={phaseSurface}
      />
      {auth.requiresLocalProfileReauthentication ? (
        <Modal
          animationType="fade"
          onRequestClose={auth.cancelLocalProfileReauthentication}
          presentationStyle="fullScreen"
          visible
        >
          <SignIn
            initialMode="local"
            localReauthentication
            onCancel={auth.cancelLocalProfileReauthentication}
            platform="tv"
          />
        </Modal>
      ) : null}
    </View>
  );
}

function MobileRootGate() {
  const auth = usePorticoAuth();
  const viewerRuntime = useViewerRuntimeSnapshot();
  const product = useSignedInProductFrameState('mobile');
  const client = product.connected ? auth.session?.client : undefined;
  useDeferredDownloadProgressSync(client);
  useApplicationEventInvalidations(client);
  const phase = applicationRootPhaseForState({
    status: auth.status,
    hasAccount: Boolean(auth.account),
    transitionFailure: Boolean(viewerRuntime.transitionFailure),
  });
  let phaseSurface: React.ReactNode;
  if (
    phase === 'Account' &&
    (auth.status === 'booting' || auth.status === 'connecting')
  ) {
    phaseSurface = <LoadingState platform="mobile" />;
  } else if (phase === 'FailClosed') {
    phaseSurface = <FailClosedRecoveryState platform="mobile" />;
  } else if (phase === 'Account') {
    phaseSurface = <SignIn platform="mobile" />;
  } else if (phase === 'Profile') {
    phaseSurface = <ProfileSelectionState platform="mobile" />;
  }

  return (
    <PrototypeUiProvider platform="mobile">
      <MobileChromeMetricsProvider>
        <PersistentPlaybackProvider>
          <MobileNavigationApplication
            connected={product.connected}
            connectionSurface={product.connectionSurface}
            phase={phase}
            phaseSurface={phaseSurface}
          />
          {auth.requiresLocalProfileReauthentication ? (
            <Modal
              animationType="fade"
              onRequestClose={auth.cancelLocalProfileReauthentication}
              presentationStyle="fullScreen"
              visible
            >
              <SignIn
                initialMode="local"
                localReauthentication
                onCancel={auth.cancelLocalProfileReauthentication}
                platform="mobile"
              />
            </Modal>
          ) : null}
        </PersistentPlaybackProvider>
      </MobileChromeMetricsProvider>
    </PrototypeUiProvider>
  );
}

function ProfileSelectionState({platform}: {platform: PorticoPlatform}) {
  const auth = usePorticoAuth();
  const television = platform === 'tv';
  const selectionCopy = productMessage('auth.profile-selection-required');
  const [selectedProfileId, setSelectedProfileId] = useState<
    string | undefined
  >(auth.profileAwaitingPINId);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedProfile = auth.availableProfiles.find(
    profile => profile.id === selectedProfileId,
  );
  React.useEffect(() => {
    setSelectedProfileId(auth.profileAwaitingPINId);
    setPin('');
  }, [auth.profileAwaitingPINId]);
  const openProfile = async (profileId: string, profilePin?: string) => {
    setBusy(true);
    try {
      await auth.chooseProfile(profileId, profilePin);
    } catch {
      // Auth owns the normalized product error and keeps this selector mounted.
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={styles.profileSelectionCanvas}>
      <PorticoBrand
        accessibilityLabel="Portico"
        height={television ? 34 : 24}
        id="brand.wordmark.mono-white"
        width={television ? 154 : 108}
      />
      <View
        style={[
          styles.profileSelectionContent,
          television && styles.profileSelectionContentTV,
        ]}
      >
        <Text
          style={
            television
              ? styles.profileSelectionTitleTV
              : styles.profileSelectionTitleMobile
          }
        >
          {safeProductCopy(selectionCopy.title)}
        </Text>
        <Text
          style={
            television
              ? styles.profileSelectionSubtitleTV
              : styles.profileSelectionSubtitleMobile
          }
        >
          {safeProductCopy(selectionCopy.body)}
        </Text>
        <View style={styles.profileSelectionGrid}>
          {auth.availableProfiles.map(profile => (
            <Pressable
              accessibilityLabel={`${profile.name}${profile.hasPIN ? '. PIN required.' : ''}`}
              accessibilityRole="button"
              disabled={busy}
              key={profile.id}
              onPress={() => {
                if (profile.hasPIN) {
                  setSelectedProfileId(profile.id);
                  setPin('');
                } else {
                  void openProfile(profile.id);
                }
              }}
              style={({focused, pressed}) => [
                styles.profileSelectionCard,
                television && styles.profileSelectionCardTV,
                (focused || pressed) && styles.profileSelectionCardActive,
              ]}
            >
              <View
                style={[
                  styles.profileSelectionAvatar,
                  television && styles.profileSelectionAvatarTV,
                ]}
              >
                <Text
                  style={
                    television
                      ? styles.profileSelectionInitialsTV
                      : styles.profileSelectionInitialsMobile
                  }
                >
                  {profile.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map(part => part[0])
                    .join('')
                    .toUpperCase()}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                style={
                  television
                    ? styles.profileSelectionNameTV
                    : styles.profileSelectionNameMobile
                }
              >
                {profile.name}
              </Text>
              {profile.hasPIN ? (
                <Text style={styles.profileSelectionPINLabel}>PIN</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
        {selectedProfile ? (
          <View
            style={[
              styles.profilePINPanel,
              television && styles.profilePINPanelTV,
            ]}
          >
            <Text
              style={
                television
                  ? styles.profilePINTitleTV
                  : styles.profilePINTitleMobile
              }
            >
              {safeProductCopy(
                productMessage('auth.profile-pin-required', {
                  profileName: selectedProfile.name,
                }).body,
              )}
            </Text>
            <TextInput
              accessibilityLabel={`${selectedProfile.name} PIN`}
              autoFocus={!television}
              editable={!busy}
              keyboardType="number-pad"
              maxLength={4}
              onChangeText={value =>
                setPin(value.replace(/\D/g, '').slice(0, 4))
              }
              placeholder="PIN"
              placeholderTextColor={color.mutedSilver}
              secureTextEntry
              style={[
                styles.profilePINInput,
                television && styles.profilePINInputTV,
              ]}
              value={pin}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || !/^\d{4}$/.test(pin)}
              onPress={() => void openProfile(selectedProfile.id, pin)}
              style={({focused, pressed}) => [
                styles.profilePINButton,
                (focused || pressed) && styles.profilePINButtonActive,
                (busy || !/^\d{4}$/.test(pin)) &&
                  styles.profilePINButtonDisabled,
              ]}
            >
              <Text
                style={
                  television
                    ? styles.profilePINButtonLabelTV
                    : styles.profilePINButtonLabelMobile
                }
              >
                {busy
                  ? productMessageText('state.loading')
                  : productMessageText('action.open-profile')}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {auth.serverError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {auth.serverError}
          </Text>
        ) : null}
        <TextButton
          label="Sign out of Portico Account"
          onPress={() => void auth.signOut()}
        />
      </View>
    </SafeAreaView>
  );
}

export function serverConnectionStateLabel(
  state: 'unknown' | 'connecting' | 'reachable' | 'unreachable',
): string {
  switch (state) {
    case 'connecting':
      return 'Checking connection';
    case 'reachable':
      return 'Connected';
    case 'unreachable':
      return 'Connection failed';
    default:
      return 'Not checked';
  }
}

function AccountConnectionContent({platform}: {platform: PorticoPlatform}) {
  const auth = usePorticoAuth();
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const unavailableId = auth.account
    ? ('problem.server-unavailable' as const)
    : ('problem.connection-failed' as const);
  const unavailableVariables = {
    serverName: auth.selectedServer?.name ?? 'this server',
  };
  const unavailable = productMessage(unavailableId, unavailableVariables);
  const presentation = auth.issue?.presentation;
  const openServer = async (server: (typeof auth.availableServers)[number]) => {
    try {
      await auth.chooseServer(server);
    } catch {
      // Auth owns the phase-accurate issue and keeps recovery available.
    }
  };
  const connectingServerId = auth.availableServers.find(
    server => auth.serverConnectionStates[server.id] === 'connecting',
  )?.id;
  return (
    <ScrollView
      contentContainerStyle={[
        styles.connectionContent,
        platform === 'tv' && styles.connectionContentTV,
      ]}
      showsVerticalScrollIndicator={false}
      testID={`portico-${platform}-connection-content`}
    >
      <EmptyState
        actionLabel={productMessageText('action.retry')}
        message={safeProductCopy(
          presentation?.body ?? presentation?.text ?? auth.serverError,
          productMessageText(unavailableId, unavailableVariables),
        )}
        onAction={() => void auth.retryServerDiscovery()}
        platform={platform}
        title={safeProductCopy(
          presentation?.title ?? unavailable.title,
          productMessageText(unavailableId, unavailableVariables),
        )}
      />
      {auth.availableServers.length ? (
        <View style={styles.serverRecoveryList}>
          <Text style={styles.serverRecoveryHeading}>Your servers</Text>
          {auth.availableServers.map(server => {
            const connectionState =
              auth.serverConnectionStates[server.id] ?? 'unknown';
            const connectionLabel = serverConnectionStateLabel(connectionState);
            return (
              <Pressable
                accessibilityLabel={`${server.name}. ${connectionLabel}.`}
                accessibilityRole="button"
                disabled={Boolean(connectingServerId)}
                key={server.id}
                onPress={() => void openServer(server)}
                style={({focused, pressed}) => [
                  styles.serverRecoveryButton,
                  (focused || pressed) && styles.serverRecoveryButtonActive,
                ]}
              >
                <View>
                  <Text style={styles.serverRecoveryName}>{server.name}</Text>
                  <Text style={styles.serverRecoveryStatus}>
                    {connectionLabel}
                  </Text>
                </View>
                {connectionState === 'connecting' ? (
                  <ActivityIndicator color={color.screenBlueStrong} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {platform === 'mobile' && auth.account ? (
        <TextButton
          label="Portico Account settings"
          onPress={() => setShowAccountSettings(true)}
        />
      ) : null}
      <TextButton
        onPress={() => void auth.signOut()}
        label="Sign out of Portico Account"
      />
      {platform === 'mobile' && auth.account ? (
        <AccountSelfServiceModal
          account={auth.account}
          auth={auth}
          onClose={() => setShowAccountSettings(false)}
          visible={showAccountSettings}
        />
      ) : null}
    </ScrollView>
  );
}

function useSignedInProductFrameState(platform: PorticoPlatform) {
  const auth = usePorticoAuth();
  const viewerRuntime = useViewerRuntimeSnapshot();
  const connected =
    auth.status === 'authenticated' &&
    Boolean(auth.session) &&
    !viewerRuntime.transitioning &&
    !viewerRuntime.transitionFailure;
  const continuity = resolveProductContinuity({
    connecting:
      auth.status === 'connecting' ||
      auth.status === 'selecting-server' ||
      viewerRuntime.transitioning ||
      (auth.status === 'authenticated' && !auth.session),
    failure:
      auth.status === 'server-unavailable'
        ? {kind: 'unavailable', messageId: 'problem.server-unavailable'}
        : undefined,
  });
  const requiresServerChoice =
    auth.status === 'selecting-server' &&
    auth.availableServers.length > 0 &&
    !Object.values(auth.serverConnectionStates).some(
      state => state === 'connecting',
    );
  const connectionSurface =
    continuity.presentation === 'reserved' && !requiresServerChoice ? (
      <ReservedConnectionContent platform={platform} />
    ) : (
      <AccountConnectionContent platform={platform} />
    );
  return {client: auth.session?.client, connected, connectionSurface};
}

function ReservedConnectionContent({platform}: {platform: PorticoPlatform}) {
  const television = platform === 'tv';
  return (
    <ScrollView
      accessible={false}
      contentContainerStyle={[
        styles.connectionReserved,
        television && styles.connectionReservedTV,
      ]}
      pointerEvents="none"
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      style={styles.connectionReservedScroll}
      testID={`portico-${platform}-connection-reserved`}
    >
      <View
        style={[
          styles.connectionReservedTitle,
          television && styles.connectionReservedTitleTV,
        ]}
      />
      <View
        style={[
          styles.connectionReservedBody,
          television && styles.connectionReservedBodyTV,
        ]}
      />
      <View
        style={[
          styles.connectionReservedBodyShort,
          television && styles.connectionReservedBodyShortTV,
        ]}
      />
      <View
        style={[
          styles.connectionReservedShelf,
          television && styles.connectionReservedShelfTV,
        ]}
      >
        {[0, 1, 2, 3].map(index => (
          <View
            key={index}
            style={[
              styles.connectionReservedCard,
              television && styles.connectionReservedCardTV,
            ]}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function SignIn({
  platform,
  initialMode,
  localReauthentication = false,
  onCancel,
}: {
  platform: PorticoPlatform;
  initialMode?: 'local';
  localReauthentication?: boolean;
  onCancel?(): void;
}) {
  const auth = usePorticoAuth();
  const [mode, setMode] = useState<
    'setup' | 'portico' | 'local' | 'mfa' | 'reset' | 'register'
  >(initialMode ?? (platform === 'tv' ? 'setup' : 'portico'));
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [secondFactorKind, setSecondFactorKind] = useState<'totp' | 'recovery'>(
    'totp',
  );
  const [secondFactorCode, setSecondFactorCode] = useState('');
  const [formError, setFormError] = useState<string>();
  const [formNotice, setFormNotice] = useState<string>();
  const [resetSent, setResetSent] = useState(false);
  const [working, setWorking] = useState(false);
  const [serverURL, setServerURL] = useState('');
  const [nearbyServers, setNearbyServers] = useState<
    readonly NormalizedPorticoDiscoveryRecord[]
  >([]);
  const [selectedNearbyServer, setSelectedNearbyServer] =
    useState<NormalizedPorticoDiscoveryRecord>();
  const localServerInputRef = useRef<TextInput>(null);
  const localLoginInputRef = useRef<TextInput>(null);
  const localPasswordInputRef = useRef<TextInput>(null);
  const busy = working || auth.status === 'connecting';

  React.useEffect(
    () =>
      mode === 'local'
        ? subscribeToNearbyPorticoServers(setNearbyServers)
        : undefined,
    [mode],
  );

  const submit = async () => {
    if (busy) return;
    setFormError(undefined);
    setFormNotice(undefined);
    setWorking(true);
    try {
      if (mode === 'portico' || (platform === 'tv' && mode === 'setup')) {
        await auth.signInWithPortico(email, password);
      } else if (mode === 'mfa') {
        if (!secondFactorCode.trim())
          throw new ProductMessageError('problem.invalid-request');
        await auth.signInWithPortico(email, password, {
          kind: secondFactorKind,
          code: secondFactorCode,
        });
      } else if (mode === 'register') {
        if (!validPorticoUsername(username))
          throw new ProductMessageError('problem.invalid-request');
        if (!validPorticoPassword(password))
          throw new ProductMessageError('problem.invalid-request');
        if (password !== passwordConfirmation)
          throw new ProductMessageError('problem.invalid-request');
        await auth.registerPorticoAccount(email, username, password);
      } else if (mode === 'reset') {
        if (!email.trim())
          throw new ProductMessageError('problem.invalid-request');
        await auth.requestPasswordReset(email);
        setResetSent(true);
      } else {
        await auth.signInWithLocalAuth(
          serverURL,
          login,
          password,
          selectedNearbyServer
            ? {
                serverId: selectedNearbyServer.serverId,
                serverPublicKeyFingerprint:
                  selectedNearbyServer.serverPublicKeyFingerprint,
              }
            : undefined,
        );
      }
    } catch (cause) {
      if (isAccountCreatedSignInRequired(cause)) {
        setEmail(cause.email);
        setPassword('');
        setPasswordConfirmation('');
        setMode('portico');
        setFormNotice(cause.message);
      } else if (isMFARequired(cause)) {
        setSecondFactorCode('');
        setMode('mfa');
      } else {
        setFormError(productErrorMessageId(cause, 'problem.request-failed'));
      }
    } finally {
      setWorking(false);
    }
  };
  const returnToPortico = () => {
    auth.clearError();
    setFormError(undefined);
    setFormNotice(undefined);
    setResetSent(false);
    setPassword('');
    setPasswordConfirmation('');
    setSecondFactorCode('');
    setMode('portico');
  };
  if (platform === 'tv' && mode === 'setup')
    return (
      <TVSetup
        accountError={formError ?? auth.error}
        busy={busy}
        email={email}
        onEmailChange={setEmail}
        onLocal={() => {
          auth.clearError();
          setFormError(undefined);
          setPassword('');
          setMode('local');
        }}
        onPasswordChange={setPassword}
        onSubmit={() => void submit()}
        password={password}
      />
    );
  const title =
    mode === 'local'
      ? 'Server Only Authentication'
      : mode === 'mfa'
        ? 'Verify it’s you.'
        : mode === 'reset'
          ? 'Reset your password.'
          : mode === 'register'
            ? productMessageText('account.create-title')
            : 'Welcome home.';
  const copy =
    mode === 'local'
      ? localReauthentication
        ? 'Confirm your server credentials to switch profiles on this server.'
        : 'Connect directly to a Portico server with a local profile.'
      : mode === 'mfa'
        ? secondFactorKind === 'totp'
          ? 'Enter the six-digit code from the authenticator app linked to your Portico Account.'
          : 'Use one of the single-use recovery codes you saved when you enabled MFA.'
        : mode === 'reset'
          ? 'We’ll email a password reset link if an account exists for this address.'
          : mode === 'register'
            ? productMessageText('account.create-intro')
            : 'Sign in with your Portico Account to access servers shared with you.';
  return (
    <SafeAreaView style={styles.signInCanvas}>
      <AmbientArtworkGlow platform={platform} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={platform === 'mobile'}
        style={styles.signInKeyboardAvoider}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets={platform === 'mobile'}
          contentContainerStyle={styles.signInScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.signInScrollView}
        >
          <View
            style={[
              styles.signInCard,
              platform === 'tv' && styles.signInCardTV,
            ]}
          >
            <PorticoBrand
              accessibilityLabel="Portico"
              height={platform === 'tv' ? 34 : 24}
              id="brand.wordmark.mono-white"
              width={platform === 'tv' ? 154 : 108}
            />
            <Text
              style={[styles.signInTitle, platform === 'tv' && tvType.title]}
            >
              {title}
            </Text>
            <Text
              style={[
                styles.signInCopy,
                platform === 'tv' && tvType.supporting,
              ]}
            >
              {copy}
            </Text>
            {mode === 'reset' && resetSent ? (
              <View
                accessibilityLiveRegion="polite"
                style={styles.successMessage}
              >
                <Text style={styles.successTitle}>Check your email</Text>
                <Text style={styles.successCopy}>
                  If a Portico Account exists for {email.trim()}, its reset link
                  is on the way. Use it to choose a new password.
                </Text>
              </View>
            ) : null}
            {mode === 'local' && (
              <>
                <Field
                  inputRef={localServerInputRef}
                  label="Server address"
                  value={serverURL}
                  onChangeText={value => {
                    setServerURL(value);
                    setSelectedNearbyServer(undefined);
                  }}
                  placeholder="https://portico.local:32500"
                  requestInitialTVFocus={platform === 'tv'}
                  returnKeyType="next"
                  onSubmitEditing={
                    platform === 'tv'
                      ? undefined
                      : () => localLoginInputRef.current?.focus()
                  }
                  television={platform === 'tv'}
                />
                {nearbyServers.length ? (
                  <View style={styles.nearbyServers}>
                    <Text
                      style={[
                        styles.nearbyHeading,
                        platform === 'tv' && styles.nearbyHeadingTV,
                      ]}
                    >
                      Nearby servers
                    </Text>
                    {nearbyServers.map(server => (
                      <Pressable
                        accessibilityRole="button"
                        key={server.serverPublicKeyFingerprint}
                        onPress={() => {
                          setSelectedNearbyServer(server);
                          setServerURL(server.routes[0]?.url ?? '');
                        }}
                        style={({focused, pressed}) => [
                          styles.nearbyServer,
                          (focused || pressed) && styles.nearbyServerActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.nearbyServerName,
                            platform === 'tv' && styles.nearbyServerNameTV,
                          ]}
                        >
                          {server.displayName}
                        </Text>
                        <Text
                          style={[
                            styles.nearbyServerDetail,
                            platform === 'tv' && styles.nearbyServerDetailTV,
                          ]}
                        >
                          Nearby on your local network
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text
                    style={[
                      styles.nearbyHelp,
                      platform === 'tv' && styles.nearbyHelpTV,
                    ]}
                  >
                    Looking for Portico servers on your local network…
                  </Text>
                )}
              </>
            )}
            {mode === 'register' ? (
              <Field
                autoComplete="username"
                autoCapitalize="none"
                label="Username"
                value={username}
                onChangeText={setUsername}
                placeholder="Choose a username"
              />
            ) : null}
            {(mode === 'portico' || mode === 'register' || mode === 'reset') &&
            !resetSent ? (
              <Field
                autoComplete={mode === 'portico' ? 'username' : 'email'}
                keyboardType={mode === 'portico' ? 'default' : 'email-address'}
                label={mode === 'portico' ? 'Username or email' : 'Email'}
                value={email}
                onChangeText={setEmail}
                placeholder={
                  mode === 'portico' ? 'Username or email' : 'you@example.com'
                }
              />
            ) : null}
            {mode === 'local' ? (
              <Field
                autoComplete="username"
                inputRef={localLoginInputRef}
                label="Username or email"
                value={login}
                onChangeText={setLogin}
                placeholder="Username or email"
                returnKeyType="next"
                onSubmitEditing={
                  platform === 'tv'
                    ? undefined
                    : () => localPasswordInputRef.current?.focus()
                }
                television={platform === 'tv'}
              />
            ) : null}
            {mode === 'portico' || mode === 'register' ? (
              <Field
                autoComplete={
                  mode === 'register' ? 'new-password' : 'current-password'
                }
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder={
                  mode === 'register' ? 'Create a secure password' : 'Password'
                }
              />
            ) : null}
            {mode === 'register' ? (
              <PasswordRequirements value={password} />
            ) : null}
            {mode === 'register' ? (
              <Field
                autoComplete="new-password"
                label="Confirm password"
                value={passwordConfirmation}
                onChangeText={setPasswordConfirmation}
                secureTextEntry
                placeholder="Enter it again"
              />
            ) : null}
            {mode === 'local' ? (
              <Field
                autoComplete="current-password"
                inputRef={localPasswordInputRef}
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="Password"
                returnKeyType="done"
                onSubmitEditing={
                  platform === 'tv' ? undefined : () => void submit()
                }
                television={platform === 'tv'}
              />
            ) : null}
            {mode === 'mfa' ? (
              <>
                <Field
                  autoComplete="one-time-code"
                  keyboardType={
                    secondFactorKind === 'totp' ? 'number-pad' : 'default'
                  }
                  label={
                    secondFactorKind === 'totp'
                      ? 'Authenticator code'
                      : 'Recovery code'
                  }
                  maxLength={secondFactorKind === 'totp' ? 6 : undefined}
                  value={secondFactorCode}
                  onChangeText={setSecondFactorCode}
                  placeholder={
                    secondFactorKind === 'totp' ? '000000' : 'Recovery code'
                  }
                />
                <TextButton
                  label={
                    secondFactorKind === 'totp'
                      ? 'Use a recovery code'
                      : 'Use an authenticator code'
                  }
                  onPress={() => {
                    setSecondFactorCode('');
                    setFormError(undefined);
                    setSecondFactorKind(value =>
                      value === 'totp' ? 'recovery' : 'totp',
                    );
                  }}
                />
              </>
            ) : null}
            {formNotice ? (
              <View
                accessibilityLiveRegion="polite"
                style={styles.successMessage}
              >
                <Text style={styles.successTitle}>Account created</Text>
                <Text style={styles.successCopy}>{formNotice}</Text>
              </View>
            ) : null}
            {(formError || auth.error) && (
              <Text accessibilityRole="alert" style={styles.error}>
                {formError ?? auth.error}
              </Text>
            )}
            {!resetSent ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void submit()}
                style={({focused, pressed}) => [
                  styles.primaryButton,
                  platform === 'tv' && styles.primaryTVButton,
                  (focused || pressed) && styles.primaryButtonActive,
                  platform === 'tv' &&
                    (focused || pressed) &&
                    styles.primaryTVButtonFocused,
                  busy && styles.disabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={color.projector} />
                ) : (
                  <Text
                    style={[
                      styles.primaryButtonText,
                      platform === 'tv' && styles.primaryTVLabel,
                    ]}
                  >
                    {mode === 'reset'
                      ? 'Send reset link'
                      : mode === 'register'
                        ? 'Create account'
                        : mode === 'mfa'
                          ? 'Verify and continue'
                          : 'Continue'}
                  </Text>
                )}
              </Pressable>
            ) : null}
            {mode === 'portico' ? (
              <View style={styles.accountLinks}>
                <TextButton
                  label="Forgot password?"
                  onPress={() => {
                    auth.clearError();
                    setFormError(undefined);
                    setMode('reset');
                  }}
                />
                <TextButton
                  label="Create a Portico Account"
                  onPress={() => {
                    auth.clearError();
                    setFormError(undefined);
                    setPassword('');
                    setMode('register');
                  }}
                />
              </View>
            ) : null}
            {mode === 'portico' && platform === 'mobile' ? (
              <TextButton
                label="Sign In With Server Only Authentication"
                onPress={() => {
                  auth.clearError();
                  setFormError(undefined);
                  setPassword('');
                  setMode('local');
                }}
              />
            ) : null}
            {mode !== 'portico' ? (
              <TextButton
                label={
                  localReauthentication && mode === 'local'
                    ? 'Cancel'
                    : platform === 'tv' && mode === 'local'
                      ? 'Back to Portico sign in'
                      : 'Back to sign in'
                }
                television={platform === 'tv'}
                onPress={
                  localReauthentication && mode === 'local' && onCancel
                    ? onCancel
                    : platform === 'tv' && mode === 'local'
                      ? () => {
                          setPassword('');
                          setMode('setup');
                        }
                      : returnToPortico
                }
              />
            ) : platform === 'tv' ? (
              <TextButton
                label="Back to Portico sign in"
                onPress={() => {
                  setPassword('');
                  setMode('setup');
                }}
              />
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TextButton({
  label,
  onPress,
  television = false,
}: {
  label: string;
  onPress(): void;
  television?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({focused, pressed}) => [
        styles.textButton,
        television && styles.textButtonTV,
        (focused || pressed) && styles.textButtonActive,
      ]}
    >
      <Text
        style={[styles.textButtonLabel, television && styles.textButtonLabelTV]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TVSetup({
  accountError,
  busy,
  email,
  onEmailChange,
  onLocal,
  onPasswordChange,
  onSubmit,
  password,
}: {
  accountError?: string;
  busy: boolean;
  email: string;
  onEmailChange(value: string): void;
  onLocal(): void;
  onPasswordChange(value: string): void;
  onSubmit(): void;
  password: string;
}) {
  const {completeNearbyTVSetup} = usePorticoAuth();
  const [display, setDisplay] = useState<NearbyTVSetupDisplay>();
  const [completionError, setCompletionError] = useState<string>();
  const [terminalError, setTerminalError] = useState(false);
  const [attempt, setAttempt] = useState({
    id: 0,
    replaceTerminalSession: false,
  });

  React.useEffect(() => {
    let mounted = true;
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setDisplay(undefined);
    setCompletionError(undefined);
    setTerminalError(false);

    const complete = async () => {
      const scopedInstallationId = await clientMetadataId();
      const descriptor = porticoClientDescriptor('tv');
      const grant = await authorizeNearbyTV({
        appVersion: descriptor.appVersion,
        client: hostedClient,
        deviceName: descriptor.deviceName,
        installationId: scopedInstallationId,
        onDisplay: session => {
          if (mounted) setDisplay(session);
        },
        persistCredentials: persistNearbyTVCredentials,
        platform: descriptor.nativePlatform,
        replaceSession: attempt.replaceTerminalSession,
        signal: controller.signal,
        storage: nearbyTVSetupSessionStore,
      });
      await completeNearbyTVSetup(grant);
    };

    complete().catch(cause => {
      if (!mounted || controller.signal.aborted) return;
      if (shouldAutomaticallyRenewNearbyTVSetup(cause)) {
        setDisplay(undefined);
        setCompletionError(undefined);
        renewalTimer = setTimeout(() => {
          if (!mounted) return;
          setAttempt(current => ({
            id: current.id + 1,
            replaceTerminalSession: true,
          }));
        }, 1_000);
        return;
      }
      const message = productErrorMessageId(cause, 'problem.request-failed');
      const terminal = isTerminalNearbyTVSetupFailure(cause);
      setTerminalError(terminal);
      setCompletionError(message);
    });
    return () => {
      mounted = false;
      if (renewalTimer) clearTimeout(renewalTimer);
      controller.abort();
    };
  }, [attempt, completeNearbyTVSetup]);

  const displayCode = formatTVSetupCode(display?.code);
  const retry = () =>
    setAttempt(current => ({
      id: current.id + 1,
      replaceTerminalSession: terminalError,
    }));
  return (
    <SafeAreaView style={styles.tvSetupCanvas}>
      <AmbientArtworkGlow platform="tv" />
      <View style={styles.tvSetupPanel}>
        <PorticoBrand
          accessibilityLabel="Portico"
          height={74}
          id="brand.wordmark.mono-white"
          width={336}
        />
        <View style={styles.tvSetupColumns}>
          <View style={styles.tvQuickCodeColumn}>
            <Text style={[tvType.title, styles.tvSetupColumnTitle]}>
              Quick connect
            </Text>
            <Text style={[tvType.body, styles.tvSetupColumnCopy]}>
              Open Portico on your phone, choose Cast, and select this TV.
            </Text>
            {!display && !completionError ? (
              <ActivityIndicator color={color.screenBlue} size="large" />
            ) : (
              <Text
                accessibilityLabel={setupCodeAccessibilityLabel(displayCode)}
                style={styles.setupCode}
              >
                {displayCode ?? '—'}
              </Text>
            )}
            {completionError ? (
              <Text style={styles.tvSetupError}>{completionError}</Text>
            ) : null}
            {completionError ? (
              <Pressable
                accessibilityRole="button"
                onPress={retry}
                style={({focused}) => [
                  styles.secondaryTVButton,
                  focused && styles.focused,
                ]}
              >
                <Text style={styles.secondaryTVLabel}>
                  {terminalError ? 'Request a new code' : 'Try again'}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View accessibilityElementsHidden style={styles.tvSetupDivider} />
          <TVFocusGuideView autoFocus style={styles.tvAccountColumn}>
            <Text style={[tvType.title, styles.tvSetupColumnTitle]}>
              Portico Account
            </Text>
            <Text style={[tvType.body, styles.tvSetupColumnCopy]}>
              Sign in with your username or email and password.
            </Text>
            <Field
              autoComplete="username"
              label="Username or email"
              onChangeText={onEmailChange}
              placeholder="Username or email"
              requestInitialTVFocus
              television
              value={email}
            />
            <Field
              autoComplete="current-password"
              label="Password"
              onChangeText={onPasswordChange}
              placeholder="Password"
              secureTextEntry
              television
              value={password}
            />
            {accountError ? (
              <Text accessibilityRole="alert" style={styles.tvSetupError}>
                {accountError}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onSubmit}
              style={({focused, pressed}) => [
                styles.primaryTVButton,
                styles.tvAccountButton,
                (focused || pressed) && styles.primaryTVButtonFocused,
                busy && styles.disabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={color.projector} />
              ) : (
                <Text style={styles.primaryTVLabel}>Sign In</Text>
              )}
            </Pressable>
            <View
              accessibilityElementsHidden
              style={styles.tvAlternativeDivider}
            >
              <View style={styles.tvAlternativeLine} />
              <Text style={styles.tvAlternativeLabel}>or</Text>
              <View style={styles.tvAlternativeLine} />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={onLocal}
              style={({focused}) => [
                styles.tvServerOnlyAction,
                focused && styles.tvServerOnlyActionFocused,
              ]}
            >
              <Text style={styles.tvServerOnlyLabel}>
                Sign in with server-only authentication
              </Text>
            </Pressable>
          </TVFocusGuideView>
        </View>
      </View>
    </SafeAreaView>
  );
}

function isTerminalNearbyTVSetupFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const code =
    'code' in value && typeof value.code === 'string'
      ? value.code.toLowerCase()
      : '';
  if (['access_denied', 'expired_token'].includes(code)) return true;
  const diagnostic =
    'message' in value && typeof value.message === 'string'
      ? value.message
      : '';
  return /expired|no longer available|invalid Nearby TV setup session/i.test(
    diagnostic,
  );
}

function shouldAutomaticallyRenewNearbyTVSetup(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const code =
    'code' in value && typeof value.code === 'string'
      ? value.code.toLowerCase()
      : '';
  if (code === 'expired_token') return true;
  const diagnostic =
    'message' in value && typeof value.message === 'string'
      ? value.message
      : '';
  return /code has expired|session is no longer available/i.test(diagnostic);
}

function Field({
  inputRef,
  label,
  onBlur,
  onFocus,
  requestInitialTVFocus = false,
  secureTextEntry,
  style,
  television = false,
  ...props
}: React.ComponentProps<typeof TextInput> & {
  inputRef?: React.RefObject<TextInput | null>;
  label: string;
  requestInitialTVFocus?: boolean;
  television?: boolean;
}) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const fieldValue =
    typeof props.value === 'string'
      ? props.value
      : typeof props.defaultValue === 'string'
        ? props.defaultValue
        : '';
  const televisionDisplayValue =
    secureTextEntry && !passwordVisible
      ? '•'.repeat(fieldValue.length)
      : fieldValue;
  const input = (
    <TextInput
      autoCapitalize="none"
      focusable={television || undefined}
      hasTVPreferredFocus={television && requestInitialTVFocus}
      ref={inputRef}
      onBlur={event => {
        setFocused(false);
        onBlur?.(event);
      }}
      onFocus={event => {
        setFocused(true);
        onFocus?.(event);
      }}
      placeholderTextColor={color.mutedSilver}
      {...props}
      secureTextEntry={Boolean(secureTextEntry && !passwordVisible)}
      submitBehavior={
        television
          ? (props.submitBehavior ?? 'blurAndSubmit')
          : props.submitBehavior
      }
      style={[
        styles.input,
        television && styles.inputTV,
        secureTextEntry && styles.passwordInput,
        style,
      ]}
    />
  );
  const televisionFieldChrome = television ? (
    <View
      pointerEvents="none"
      style={[styles.inputTVChrome, focused && styles.inputTVChromeFocused]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.inputTVChromeText,
          !televisionDisplayValue && styles.inputTVChromePlaceholder,
        ]}
      >
        {televisionDisplayValue || props.placeholder || ''}
      </Text>
    </View>
  ) : null;
  return (
    <View style={[styles.field, television && styles.fieldTV]}>
      <Text style={[styles.fieldLabel, television && styles.fieldLabelTV]}>
        {label}
      </Text>
      {secureTextEntry ? (
        <View style={styles.passwordField}>
          {input}
          {televisionFieldChrome}
          <Pressable
            accessibilityLabel={`${productMessageText(passwordVisible ? 'auth.password.hide' : 'auth.password.show')}: ${label}`}
            accessibilityRole="button"
            accessibilityState={{expanded: passwordVisible}}
            disabled={props.editable === false}
            focusable={!television}
            hitSlop={8}
            onPress={() => setPasswordVisible(current => !current)}
            style={({pressed}) => [
              styles.passwordVisibility,
              television && styles.passwordVisibilityTV,
              pressed && styles.passwordVisibilityPressed,
            ]}
          >
            <PorticoIcon
              color={color.softSilver}
              id={
                passwordVisible
                  ? 'account.visibility.hide'
                  : 'account.visibility.show'
              }
              size={19}
            />
          </Pressable>
        </View>
      ) : television ? (
        <View style={styles.tvInputShell}>
          {input}
          {televisionFieldChrome}
        </View>
      ) : (
        input
      )}
    </View>
  );
}

function PasswordRequirements({value}: {value: string}) {
  const strength = porticoPasswordStrength(value);
  const strengthLabel = passwordStrengthLabel(strength);
  return (
    <View
      accessibilityLabel="Password requirements"
      accessibilityLiveRegion="polite"
      style={styles.passwordRequirements}
    >
      {porticoPasswordRequirements.map(requirement => {
        const met = requirement.test(value);
        return (
          <View
            accessibilityLabel={`${requirement.label}, ${met ? 'met' : 'not met'}`}
            key={requirement.label}
            style={styles.passwordRequirementRow}
          >
            <PorticoIcon
              color={met ? color.healthy : color.dimSilver}
              id={met ? 'status.success' : 'status.empty'}
              size={15}
            />
            <Text
              style={[
                styles.passwordRequirement,
                met && styles.passwordRequirementMet,
              ]}
            >
              {requirement.label}
            </Text>
          </View>
        );
      })}
      <Text
        accessibilityLabel={`Password strength, ${strengthLabel}`}
        style={[
          styles.passwordStrength,
          strength === 'Medium' && styles.passwordStrengthMedium,
          strength === 'Strong' && styles.passwordStrengthStrong,
        ]}
      >
        Strength: {strengthLabel}
      </Text>
    </View>
  );
}
function LoadingState({platform}: {platform: PorticoPlatform}) {
  return (
    <View style={styles.loadingCanvas}>
      <AmbientArtworkGlow platform={platform} />
      <View style={styles.loadingContent}>
        <PorticoBrand
          accessibilityLabel="Portico"
          height={platform === 'tv' ? 34 : 24}
          id="brand.wordmark.mono-white"
          width={platform === 'tv' ? 154 : 108}
        />
        <ActivityIndicator color={color.screenBlueStrong} size="large" />
      </View>
    </View>
  );
}

function FailClosedRecoveryState({platform}: {platform: PorticoPlatform}) {
  const {retrySecureStorageRecovery} = usePorticoAuth();
  React.useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const recover = () => {
      void retrySecureStorageRecovery().catch(() => {
        if (!disposed) retryTimer = setTimeout(recover, 1_000);
      });
    };
    recover();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [retrySecureStorageRecovery]);
  return <LoadingState platform={platform} />;
}

function setupCodeAccessibilityLabel(code?: string) {
  if (!code) return 'Setup code unavailable';
  const [first, second] = code.split('-');
  return `Setup code ${[...first!].join(' ')}, ${[...second!].join(' ')}`;
}
const styles = StyleSheet.create({
  authenticatedRoot: {backgroundColor: color.projector, flex: 1},
  headerLeading: {alignItems: 'center', flexDirection: 'row', gap: 16},
  connectionContent: {
    alignItems: 'center',
    flexGrow: 1,
    gap: 24,
    justifyContent: 'center',
    paddingBottom: 96,
    paddingHorizontal: 24,
    paddingTop: 96,
  },
  connectionContentTV: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    maxWidth: 1040,
    paddingBottom: 72,
    paddingHorizontal: 56,
    paddingTop: 72,
  },
  connectionReserved: {
    flexGrow: 1,
    opacity: 0,
    paddingBottom: 96,
    paddingHorizontal: 24,
    paddingTop: 142,
  },
  connectionReservedScroll: {flex: 1},
  connectionReservedTV: {paddingHorizontal: 56, paddingTop: 92},
  connectionReservedTitle: {
    backgroundColor: color.recess,
    borderRadius: 8,
    height: 34,
    width: '52%',
  },
  connectionReservedTitleTV: {height: 54, maxWidth: 520},
  connectionReservedBody: {
    backgroundColor: color.recess,
    borderRadius: 6,
    height: 15,
    marginTop: 22,
    width: '86%',
  },
  connectionReservedBodyTV: {height: 22, marginTop: 28, maxWidth: 820},
  connectionReservedBodyShort: {
    backgroundColor: color.recess,
    borderRadius: 6,
    height: 15,
    marginTop: 9,
    width: '64%',
  },
  connectionReservedBodyShortTV: {height: 22, marginTop: 12, maxWidth: 620},
  connectionReservedShelf: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 54,
    overflow: 'hidden',
  },
  connectionReservedShelfTV: {gap: 24, marginTop: 72},
  connectionReservedCard: {
    aspectRatio: 2 / 3,
    backgroundColor: color.recess,
    borderRadius: 8,
    width: 112,
  },
  connectionReservedCardTV: {borderRadius: 10, width: 180},
  profileSelectionCanvas: {
    alignItems: 'center',
    backgroundColor: color.projector,
    flex: 1,
    gap: 30,
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  profileSelectionContent: {
    alignItems: 'center',
    gap: 14,
    maxWidth: 680,
    width: '100%',
  },
  profileSelectionContentTV: {gap: 22, maxWidth: 1320},
  profileSelectionTitleMobile: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 30,
    lineHeight: 38,
  },
  profileSelectionTitleTV: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 52,
    lineHeight: 62,
  },
  profileSelectionSubtitleMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  profileSelectionSubtitleTV: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 22,
    lineHeight: 30,
    textAlign: 'center',
  },
  profileSelectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
    justifyContent: 'center',
    marginVertical: 14,
  },
  profileSelectionCard: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: 12,
    borderWidth: 3,
    gap: 8,
    padding: 8,
    width: 128,
  },
  profileSelectionCardTV: {gap: 12, padding: 12, width: 210},
  profileSelectionCardActive: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  profileSelectionAvatar: {
    alignItems: 'center',
    aspectRatio: 1,
    backgroundColor: color.slate,
    borderColor: color.line,
    borderRadius: 58,
    borderWidth: 1,
    justifyContent: 'center',
    width: 92,
  },
  profileSelectionAvatarTV: {borderRadius: 84, width: 154},
  profileSelectionInitialsMobile: {
    color: color.screenBlueStrong,
    fontFamily: font.bold,
    fontSize: 28,
  },
  profileSelectionInitialsTV: {
    color: color.screenBlueStrong,
    fontFamily: font.bold,
    fontSize: 48,
  },
  profileSelectionNameMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 15,
  },
  profileSelectionNameTV: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 23,
  },
  profileSelectionPINLabel: {
    color: color.dimSilver,
    fontFamily: font.demi,
    fontSize: 11,
    letterSpacing: 1.4,
  },
  profilePINPanel: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    maxWidth: 420,
    padding: 18,
    width: '100%',
  },
  profilePINPanelTV: {gap: 18, maxWidth: 620, padding: 28},
  profilePINTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 18,
  },
  profilePINTitleTV: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 28,
  },
  profilePINInput: {
    backgroundColor: color.slate,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 22,
    letterSpacing: 8,
    minHeight: 54,
    paddingHorizontal: 16,
    textAlign: 'center',
    width: '100%',
  },
  profilePINInputTV: {fontSize: 30, minHeight: 68},
  profilePINButton: {
    alignItems: 'center',
    backgroundColor: color.silver,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 50,
    width: '100%',
  },
  profilePINButtonActive: {backgroundColor: color.screenBlueStrong},
  profilePINButtonDisabled: {opacity: 0.5},
  profilePINButtonLabelMobile: {
    color: color.projector,
    fontFamily: font.demi,
    fontSize: 16,
  },
  profilePINButtonLabelTV: {
    color: color.projector,
    fontFamily: font.demi,
    fontSize: 22,
  },
  offlineButton: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.lineStrong,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 20,
  },
  offlineButtonLabel: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 15,
  },
  serverRecoveryList: {
    gap: 8,
    maxWidth: 520,
    width: '100%',
  },
  serverRecoveryHeading: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 14,
  },
  serverRecoveryButton: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  serverRecoveryButtonActive: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  serverRecoveryName: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 15,
  },
  serverRecoveryStatus: {
    color: color.mutedSilver,
    fontFamily: font.regular,
    fontSize: 12,
    marginTop: 2,
  },
  tvSetupActions: {alignItems: 'center', gap: 12, marginTop: 20},
  primaryTVButton: {
    alignItems: 'center',
    backgroundColor: color.screenBlueStrong,
    borderColor: color.screenBlueStrong,
    borderRadius: 8,
    borderWidth: 3,
    justifyContent: 'center',
    minHeight: 72,
    minWidth: 360,
    paddingHorizontal: 28,
  },
  primaryTVLabel: {color: color.projector, fontFamily: font.demi, fontSize: 24},
  primaryTVButtonFocused: {
    backgroundColor: color.screenBlue,
    borderColor: color.focus,
  },
  appCanvas: {backgroundColor: color.projector, flex: 1, flexDirection: 'row'},
  content: {flex: 1, paddingBottom: 72},
  tvContent: {paddingBottom: 0},
  loadingCanvas: {
    alignItems: 'center',
    backgroundColor: color.projector,
    flex: 1,
    justifyContent: 'center',
  },
  loadingContent: {alignItems: 'center', gap: 22},
  muted: {color: color.dimSilver, fontFamily: font.regular},
  signInCanvas: {
    backgroundColor: color.projector,
    flex: 1,
    overflow: 'hidden',
    paddingHorizontal: 24,
  },
  signInKeyboardAvoider: {flex: 1, width: '100%'},
  signInScrollView: {width: '100%'},
  signInScroll: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 42,
  },
  signInCard: {
    gap: 18,
    maxWidth: 520,
    padding: 16,
    width: '100%',
  },
  signInCardTV: {gap: 24, maxWidth: 900, padding: 34},
  wordmark: {
    color: color.screenBlue,
    fontFamily: font.bold,
    fontSize: 19,
    letterSpacing: 4,
  },
  wordmarkMobile: {height: 24, width: 108},
  wordmarkTV: {height: 34, width: 154},
  signInTitle: {...mobileType.title, color: color.silver},
  signInCopy: {...mobileType.body, color: color.softSilver},
  field: {gap: 7},
  fieldLabel: {color: color.softSilver, fontFamily: font.medium, fontSize: 13},
  fieldTV: {gap: 8},
  fieldLabelTV: {
    color: color.softSilver,
    fontFamily: font.medium,
    fontSize: 20,
    lineHeight: 26,
  },
  input: {
    backgroundColor: color.slate,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.regular,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 15,
  },
  inputTV: {
    backgroundColor: color.transparent,
    borderColor: color.transparent,
    borderWidth: 0,
    color: color.transparent,
    fontFamily: font.regular,
    fontSize: 24,
    minHeight: 72,
    paddingHorizontal: 20,
  },
  tvInputShell: {minHeight: 72, overflow: 'hidden', position: 'relative'},
  inputTVChrome: {
    alignItems: 'center',
    backgroundColor: color.slate,
    borderColor: color.lineStrong,
    borderRadius: 8,
    borderWidth: 3,
    bottom: 0,
    flexDirection: 'row',
    left: 0,
    paddingHorizontal: 20,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  inputTVChromeFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  inputTVChromeText: {
    color: color.silver,
    fontFamily: font.regular,
    fontSize: 24,
  },
  inputTVChromePlaceholder: {color: color.mutedSilver},
  passwordField: {minHeight: 52, overflow: 'hidden', position: 'relative'},
  passwordInput: {paddingRight: 52},
  passwordVisibility: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    top: 4,
    width: 44,
  },
  passwordVisibilityTV: {right: 8, top: 14},
  passwordVisibilityPressed: {opacity: 0.68},
  passwordRequirements: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  passwordRequirementRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    width: '48%',
  },
  passwordRequirement: {
    color: color.dimSilver,
    flex: 1,
    fontFamily: font.regular,
    fontSize: 12,
  },
  passwordRequirementMet: {color: color.healthy},
  passwordStrength: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 12,
    marginTop: 2,
    width: '100%',
  },
  passwordStrengthMedium: {color: color.tunerAmber},
  passwordStrengthStrong: {color: color.healthy},
  accountLinks: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  successMessage: {
    backgroundColor: color.slate,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  successTitle: {color: color.silver, fontFamily: font.demi, fontSize: 15},
  successCopy: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  nearbyServers: {gap: 6},
  nearbyHeading: {color: color.softSilver, fontFamily: font.demi, fontSize: 13},
  nearbyHeadingTV: {fontSize: 20, lineHeight: 26},
  nearbyServer: {
    backgroundColor: color.slate,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  nearbyServerActive: {borderColor: color.screenBlue},
  nearbyServerName: {color: color.silver, fontFamily: font.demi, fontSize: 14},
  nearbyServerNameTV: {fontSize: 22, lineHeight: 28},
  nearbyServerDetail: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 11,
  },
  nearbyServerDetailTV: {fontSize: 18, lineHeight: 24},
  nearbyHelp: {color: color.dimSilver, fontFamily: font.regular, fontSize: 12},
  nearbyHelpTV: {fontSize: 18, lineHeight: 26},
  error: {color: color.record, fontFamily: font.medium, fontSize: 14},
  primaryButton: {
    alignItems: 'center',
    backgroundColor: color.silver,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonActive: {backgroundColor: color.screenBlueStrong},
  primaryButtonText: {
    color: color.projector,
    fontFamily: font.demi,
    fontSize: 16,
  },
  disabled: {opacity: 0.55},
  textButton: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 2,
    padding: 8,
  },
  textButtonTV: {minHeight: 58, paddingHorizontal: 20, paddingVertical: 12},
  textButtonActive: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  textButtonLabel: {
    color: color.screenBlue,
    fontFamily: font.demi,
    fontSize: 15,
  },
  textButtonLabelTV: {fontSize: 20, lineHeight: 28},
  tvSetupCanvas: {
    alignItems: 'center',
    backgroundColor: color.projector,
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tvSetupPanel: {
    alignItems: 'center',
    gap: 80,
    maxWidth: 1640,
    paddingHorizontal: 64,
    width: '100%',
  },
  tvSetupWordmark: {height: 74, width: 336},
  tvSetupColumns: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 64,
    justifyContent: 'center',
    width: '100%',
  },
  tvQuickCodeColumn: {alignItems: 'center', flexShrink: 0, gap: 28, width: 640},
  tvAccountColumn: {flexShrink: 0, gap: 16, width: 640},
  tvSetupDivider: {
    alignSelf: 'center',
    backgroundColor: color.lineStrong,
    height: 560,
    width: 1,
  },
  tvSetupColumnTitle: {
    alignSelf: 'stretch',
    color: color.silver,
    fontSize: 42,
    letterSpacing: -0.9,
    lineHeight: 52,
    textAlign: 'center',
  },
  tvSetupColumnCopy: {
    alignSelf: 'stretch',
    color: color.softSilver,
    fontSize: 24,
    lineHeight: 34,
    minHeight: 68,
    textAlign: 'center',
  },
  tvSetupError: {
    color: color.record,
    fontFamily: font.medium,
    fontSize: 20,
    lineHeight: 28,
    maxWidth: 620,
    textAlign: 'center',
  },
  setupCode: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 86,
    letterSpacing: 8,
    lineHeight: 104,
    maxWidth: '100%',
    textAlign: 'center',
  },
  secondaryTVButton: {
    alignItems: 'center',
    borderColor: color.lineStrong,
    borderRadius: 8,
    borderWidth: 3,
    justifyContent: 'center',
    minHeight: 64,
    paddingHorizontal: 28,
  },
  secondaryTVLabel: {color: color.silver, fontFamily: font.demi, fontSize: 22},
  tvAccountButton: {alignSelf: 'stretch', marginTop: 0},
  tvAlternativeDivider: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    marginVertical: 2,
  },
  tvAlternativeLine: {backgroundColor: color.line, flex: 1, height: 1},
  tvAlternativeLabel: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 20,
  },
  tvServerOnlyAction: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: color.recess,
    borderColor: color.lineStrong,
    borderRadius: 8,
    borderWidth: 3,
    justifyContent: 'center',
    minHeight: 68,
    paddingHorizontal: 22,
  },
  tvServerOnlyActionFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  tvServerOnlyLabel: {
    color: color.screenBlueStrong,
    fontFamily: font.demi,
    fontSize: 22,
    textAlign: 'center',
  },
  focused: {backgroundColor: color.brightSlate, borderColor: color.screenBlue},
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 72,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  tvHeader: {height: 104, paddingHorizontal: 48},
  headerTitle: {...mobileType.title, color: color.silver, fontSize: 24},
  headerActions: {alignItems: 'center', flexDirection: 'row', gap: 25},
  scrollContent: {paddingBottom: 48},
  hero: {height: 390, justifyContent: 'flex-end', overflow: 'hidden'},
  heroTV: {height: 520},
  heroScrim: {
    backgroundColor: 'rgba(7,11,16,0.38)',
    ...StyleSheet.absoluteFillObject,
  },
  heroText: {gap: 12, maxWidth: 820, padding: 30},
  row: {gap: 14, paddingHorizontal: 20, paddingTop: 28},
  cards: {gap: 14},
  card: {gap: 8, width: 122},
  cardTV: {width: 210},
  poster: {
    aspectRatio: 2 / 3,
    backgroundColor: color.slate,
    borderRadius: 8,
    width: '100%',
  },
  posterFallback: {borderColor: color.line, borderWidth: 1},
  bottomNav: {
    alignItems: 'center',
    backgroundColor: color.recess,
    borderTopColor: color.lineSoft,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    height: 72,
    justifyContent: 'space-around',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  navItem: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'center',
    minHeight: 64,
  },
  navLabel: {color: color.dimSilver, fontFamily: font.medium, fontSize: 10},
  selected: {backgroundColor: color.slate},
  rail: {
    backgroundColor: color.recess,
    borderRightColor: color.lineSoft,
    borderRightWidth: 1,
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 72,
    width: 112,
  },
  railItem: {
    alignItems: 'center',
    borderRadius: 8,
    gap: 8,
    minHeight: 76,
    padding: 10,
  },
  railLabel: {color: color.softSilver, fontFamily: font.medium, fontSize: 13},
  listSurface: {gap: 14, padding: 24},
  listRow: {
    borderBottomColor: color.lineSoft,
    borderBottomWidth: 1,
    color: color.silver,
    paddingVertical: 18,
  },
  empty: {alignItems: 'flex-start', gap: 12, padding: 28},
  retry: {
    backgroundColor: color.slate,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  retryLabel: {color: color.silver, fontFamily: font.demi},
  searchInput: {
    backgroundColor: color.slate,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.regular,
    fontSize: 17,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  rowTitle: {color: color.silver},
});
