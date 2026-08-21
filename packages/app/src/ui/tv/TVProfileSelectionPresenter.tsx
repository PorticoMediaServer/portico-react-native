import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {PorticoBrand} from '@portico-react-native/icons';
import {
  productMessageText,
  usePorticoAuth,
} from '@portico-react-native/infrastructure';
import {productMessage} from '@portico/client-core';
import {
  ControlButton,
  Focusable,
  TVLogicalFocusContainerBoundary,
} from '../primitives';
import {safeProductCopy} from '../productCopy';
import {color, font, tvType} from '../tokens';
import {TVSemanticIcon} from './TVSemanticControls';
import {tvBrowseSurfaceFocusContainer} from './surfaceFocusTopology';

const profileSelectionFocusContainer =
  tvBrowseSurfaceFocusContainer('profile-selection');

export function TVProfileSelectionPresenter() {
  const auth = usePorticoAuth();
  const [selectedProfileId, setSelectedProfileId] = useState(
    auth.profileAwaitingPINId,
  );
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = auth.availableProfiles.find(
    profile => profile.id === selectedProfileId,
  );
  useEffect(() => {
    setSelectedProfileId(auth.profileAwaitingPINId);
    setPin('');
  }, [auth.profileAwaitingPINId]);
  const choose = async (profileId: string, profilePIN?: string) => {
    setBusy(true);
    try {
      await auth.chooseProfile(profileId, profilePIN);
    } catch {
      /* Auth publishes the fenced product error. */
    } finally {
      setBusy(false);
    }
  };
  const copy = productMessage('auth.profile-selection-required');
  return (
    <TVLogicalFocusContainerBoundary container={profileSelectionFocusContainer}>
      <View style={styles.canvas} testID="portico-tv-profile-selector">
        <PorticoBrand
          accessibilityLabel="Portico"
          height={54}
          id="brand.wordmark.mono-white"
          width={190}
        />
        <View style={styles.content}>
          <Text style={tvType.title}>{safeProductCopy(copy.title)}</Text>
          <Text style={styles.subtitle}>{safeProductCopy(copy.body)}</Text>
          <View style={styles.profiles}>
            {auth.availableProfiles.map((profile, index) => (
              <Focusable
                accessibilityLabel={`${profile.name}${profile.hasPIN ? '. PIN required.' : ''}`}
                disabled={busy}
                hasTVPreferredFocus={
                  profile.id === auth.profileAwaitingPINId ||
                  (!auth.profileAwaitingPINId && index === 0)
                }
                key={profile.id}
                onPress={() => {
                  if (profile.hasPIN) {
                    setSelectedProfileId(profile.id);
                    setPin('');
                  } else void choose(profile.id);
                }}
                platform="tv"
                style={[
                  styles.profile,
                  selectedProfileId === profile.id && styles.profileSelected,
                ]}
                focusedStyle={styles.profileFocused}
                tvFocusId={`profile-selector:${profile.id}`}
              >
                <View style={styles.avatar}>
                  <Text style={styles.initials}>{initials(profile.name)}</Text>
                </View>
                <Text numberOfLines={1} style={styles.name}>
                  {profile.name}
                </Text>
                {profile.hasPIN ? (
                  <TVSemanticIcon id="status.locked" size={22} />
                ) : null}
              </Focusable>
            ))}
          </View>
          {selected ? (
            <View style={styles.pinPanel}>
              <Text style={styles.pinTitle}>
                {safeProductCopy(
                  productMessage('auth.profile-pin-required', {
                    profileName: selected.name,
                  }).body,
                )}
              </Text>
              <TextInput
                accessibilityLabel={`${selected.name} PIN`}
                autoFocus
                editable={!busy}
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
                  label={productMessageText('action.cancel')}
                  onPress={() => {
                    setSelectedProfileId(undefined);
                    setPin('');
                  }}
                  platform="tv"
                />
                <ControlButton
                  disabled={busy || !/^\d{4}$/.test(pin)}
                  label={
                    busy
                      ? productMessageText('state.loading')
                      : productMessageText('action.open-profile')
                  }
                  onPress={() => void choose(selected.id, pin)}
                  platform="tv"
                  primary
                />
              </View>
            </View>
          ) : null}
          {auth.serverError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {auth.serverError}
            </Text>
          ) : null}
          <ControlButton
            label="Sign out of Portico Account"
            onPress={() => void auth.signOut()}
            platform="tv"
          />
        </View>
      </View>
    </TVLogicalFocusContainerBoundary>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: color.projector,
    flex: 1,
    paddingHorizontal: 100,
    paddingTop: 52,
  },
  content: {gap: 22, marginTop: 42},
  subtitle: {color: color.softSilver, fontFamily: font.regular, fontSize: 23},
  profiles: {flexDirection: 'row', flexWrap: 'wrap', gap: 18},
  profile: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 14,
    minHeight: 100,
    padding: 14,
    width: 340,
  },
  profileSelected: {backgroundColor: color.raisedSlate},
  profileFocused: {
    backgroundColor: color.brightSlate,
    borderColor: color.focus,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: color.recess,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  initials: {color: color.silver, fontFamily: font.bold, fontSize: 24},
  name: {color: color.silver, flex: 1, fontFamily: font.demi, fontSize: 23},
  pinPanel: {gap: 16, maxWidth: 700},
  pinTitle: {color: color.silver, fontFamily: font.demi, fontSize: 23},
  pin: {
    backgroundColor: color.recess,
    borderColor: color.lineStrong,
    borderWidth: 2,
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 30,
    height: 64,
    paddingHorizontal: 18,
    width: 250,
  },
  actions: {flexDirection: 'row', gap: 12},
  error: {color: color.record, fontFamily: font.medium, fontSize: 19},
});
