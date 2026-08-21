import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {PorticoIcon} from '@portico-react-native/icons';
import {
  productErrorMessageId,
  productMessageText,
  usePorticoAuth,
} from '@portico-react-native/infrastructure';
import {
  unrestrictedProfilePolicy,
  type ServerManagedProfileDirectory,
} from '@porticomediaserver/client-core';
import {color, font} from '../tokens';
import {ControlButton, Focusable, IconButton} from '../primitives';
import {useModalAnimationType} from '../useReducedMotion';

const OPERATION_TIMEOUT_MS = 15_000;

export function profileAdministrationProofInput(
  value: string,
): {pin: string} | {password: string} {
  const trimmed = value.trim();
  return /^\d{4}$/.test(trimmed) ? {pin: trimmed} : {password: value};
}

export function validProfilePIN(value: string): boolean {
  return /^\d{4}$/.test(value);
}

async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPERATION_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function ProfileManagementModal({
  onClose,
  visible,
}: {
  onClose(): void;
  visible: boolean;
}) {
  const auth = usePorticoAuth();
  const client = auth.session?.client;
  const animationType = useModalAnimationType();
  const [directory, setDirectory] =
    React.useState<ServerManagedProfileDirectory>();
  const [proof, setProof] = React.useState<string>();
  const [proofInput, setProofInput] = React.useState('');
  const [showProof, setShowProof] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newPin, setNewPin] = React.useState('');
  const [accountPassword, setAccountPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [pinEditor, setPinEditor] = React.useState<{
    profileId: string;
    pin: string;
    clear: boolean;
  }>();
  const [renameEditor, setRenameEditor] = React.useState<{
    profileId: string;
    name: string;
  }>();
  const [deleteProfileId, setDeleteProfileId] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const load = React.useCallback(async () => {
    if (!client) return;
    setBusy(true);
    setError(undefined);
    try {
      setDirectory(
        await withDeadline(signal => client.accountProfiles({signal})),
      );
    } catch (cause) {
      setError(productErrorMessageId(cause, 'problem.profile-request-failed'));
    } finally {
      setBusy(false);
    }
  }, [client]);

  React.useEffect(() => {
    if (!visible) {
      setDirectory(undefined);
      setProof(undefined);
      setProofInput('');
      setNewName('');
      setNewPin('');
      setAccountPassword('');
      setPinEditor(undefined);
      setRenameEditor(undefined);
      setDeleteProfileId(undefined);
      setError(undefined);
      return;
    }
    void load();
  }, [load, visible]);

  const run = React.useCallback(
    async (operation: (signal: AbortSignal) => Promise<unknown>) => {
      setBusy(true);
      setError(undefined);
      try {
        await withDeadline(operation);
        if (client)
          setDirectory(
            await withDeadline(signal => client.accountProfiles({signal})),
          );
        return true;
      } catch (cause) {
        setError(
          productErrorMessageId(cause, 'problem.profile-request-failed'),
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  if (!visible) return null;
  return (
    <Modal
      animationType={animationType}
      onRequestClose={onClose}
      transparent
      visible
    >
      <View accessibilityViewIsModal style={styles.backdrop}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>PROFILES</Text>
              <Text style={styles.title}>
                {productMessageText('profiles.manage-title')}
              </Text>
            </View>
            <IconButton
              icon="action.close"
              label={productMessageText('action.close')}
              onPress={onClose}
              platform="mobile"
            />
          </View>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {error ? (
              <View accessibilityRole="alert" style={styles.error}>
                <Text style={styles.errorText}>{error}</Text>
                <ControlButton
                  compact
                  label={productMessageText('action.retry')}
                  onPress={() => void load()}
                  platform="mobile"
                />
              </View>
            ) : null}
            {!directory ? (
              <Text style={styles.description}>
                {busy
                  ? productMessageText('profiles.loading')
                  : productMessageText('problem.request-failed')}
              </Text>
            ) : null}
            {directory && !directory.profilesAllowed ? (
              <Text style={styles.description}>
                This server does not allow account profiles.
              </Text>
            ) : null}
            {directory?.profilesAllowed && !directory.canManage ? (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>Use the main profile</Text>
                <Text style={styles.description}>
                  Only the main profile can create profiles, change PINs, or
                  remove profiles.
                </Text>
                <ControlButton
                  label="Switch profile"
                  onPress={() => {
                    onClose();
                    void auth.beginProfileSelection();
                  }}
                  platform="mobile"
                />
              </View>
            ) : null}
            {directory?.canManage && !proof ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {productMessageText('profiles.confirm-primary-title')}
                </Text>
                <Text style={styles.description}>
                  {productMessageText(
                    directory.authority === 'local'
                      ? 'profiles.confirm-primary-local'
                      : 'profiles.confirm-primary-hosted',
                  )}
                </Text>
                <SecretField
                  label={
                    directory.authority === 'local'
                      ? 'Primary profile PIN or local account password'
                      : 'Primary profile PIN or Portico Account password'
                  }
                  onChangeText={setProofInput}
                  onToggle={() => setShowProof(value => !value)}
                  revealed={showProof}
                  value={proofInput}
                />
                <ControlButton
                  disabled={!proofInput.trim() || busy}
                  label={busy ? 'Unlocking…' : 'Unlock profile management'}
                  onPress={() =>
                    void run(async signal => {
                      const result =
                        await client!.createProfileAdministrationProof(
                          profileAdministrationProofInput(proofInput),
                          {signal},
                        );
                      setProof(result.token);
                    }).then(ok => {
                      if (ok) setProofInput('');
                    })
                  }
                  platform="mobile"
                  primary
                />
              </View>
            ) : null}
            {directory?.canManage && proof ? (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    {productMessageText('action.add-profile')}
                  </Text>
                  <TextField
                    label={productMessageText('profiles.label.new-name')}
                    onChangeText={setNewName}
                    value={newName}
                  />
                  {directory.authority === 'local' ? (
                    <TextField
                      keyboardType="number-pad"
                      label={productMessageText('profiles.label.optional-pin')}
                      maxLength={4}
                      onChangeText={value =>
                        setNewPin(value.replace(/\D/g, '').slice(0, 4))
                      }
                      value={newPin}
                    />
                  ) : null}
                  <ControlButton
                    disabled={
                      !newName.trim() ||
                      Boolean(newPin && !validProfilePIN(newPin)) ||
                      busy
                    }
                    icon="action.add"
                    label={
                      busy
                        ? 'Adding…'
                        : productMessageText('action.add-profile')
                    }
                    onPress={() =>
                      void run(signal =>
                        client!.createAccountProfile(
                          {
                            name: newName.trim(),
                            pin: newPin || undefined,
                            policy: {
                              ...unrestrictedProfilePolicy,
                              blockedLabels: [
                                ...unrestrictedProfilePolicy.blockedLabels,
                              ],
                            },
                          },
                          proof,
                          {signal},
                        ),
                      ).then(ok => {
                        if (ok) {
                          setNewName('');
                          setNewPin('');
                        }
                      })
                    }
                    platform="mobile"
                    primary
                  />
                </View>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Profiles</Text>
                  {(directory.profiles ?? []).map(profile => {
                    const editing = pinEditor?.profileId === profile.id;
                    const deleting = deleteProfileId === profile.id;
                    return (
                      <View key={profile.id} style={styles.profileCard}>
                        <View style={styles.profileSummary}>
                          <View style={styles.avatar}>
                            <PorticoIcon color={color.softSilver} id="account.profile" size={24} />
                          </View>
                          <View style={styles.profileCopy}>
                            <Text style={styles.profileName}>
                              {profile.name}
                            </Text>
                            <Text style={styles.profileMeta}>
                              {profile.isPrimary
                                ? productMessageText('profiles.status.primary')
                                : profile.hasPIN
                                  ? productMessageText(
                                      'profiles.status.pin-protected',
                                    )
                                  : productMessageText(
                                      'profiles.status.no-pin',
                                    )}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.actions}>
                          <ControlButton
                            compact
                            icon="status.locked"
                            label={profile.hasPIN ? 'Change PIN' : 'Add PIN'}
                            onPress={() => {
                              setDeleteProfileId(undefined);
                              setRenameEditor(undefined);
                              setPinEditor({
                                profileId: profile.id,
                                pin: '',
                                clear: false,
                              });
                            }}
                            platform="mobile"
                          />
                          <ControlButton
                            compact
                            icon="account.edit-profile"
                            label="Rename"
                            onPress={() => {
                              setDeleteProfileId(undefined);
                              setPinEditor(undefined);
                              setRenameEditor({
                                profileId: profile.id,
                                name: profile.name,
                              });
                            }}
                            platform="mobile"
                          />
                          {profile.hasPIN ? (
                            <ControlButton
                              compact
                              label="Remove PIN"
                              onPress={() => {
                                setDeleteProfileId(undefined);
                                setRenameEditor(undefined);
                                setPinEditor({
                                  profileId: profile.id,
                                  pin: '',
                                  clear: true,
                                });
                              }}
                              platform="mobile"
                            />
                          ) : null}
                          {!profile.isPrimary ? (
                            <ControlButton
                              compact
                              icon="action.delete"
                              label={productMessageText(
                                'action.remove-profile',
                              )}
                              onPress={() => {
                                setPinEditor(undefined);
                                setRenameEditor(undefined);
                                setDeleteProfileId(profile.id);
                              }}
                              platform="mobile"
                            />
                          ) : null}
                        </View>
                        {editing ? (
                          <View style={styles.inlineEditor}>
                            {!pinEditor.clear ? (
                              <TextField
                                keyboardType="number-pad"
                                label="New four-digit PIN"
                                maxLength={4}
                                onChangeText={value =>
                                  setPinEditor(current =>
                                    current
                                      ? {
                                          ...current,
                                          pin: value
                                            .replace(/\D/g, '')
                                            .slice(0, 4),
                                        }
                                      : current,
                                  )
                                }
                                value={pinEditor.pin}
                              />
                            ) : (
                              <Text style={styles.description}>
                                Remove the PIN from {profile.name}?
                              </Text>
                            )}
                            <SecretField
                              label={productMessageText(
                                directory.authority === 'hosted'
                                  ? 'profiles.label.portico-account-password'
                                  : 'profiles.label.account-password',
                              )}
                              onChangeText={setAccountPassword}
                              onToggle={() => setShowPassword(value => !value)}
                              revealed={showPassword}
                              value={accountPassword}
                            />
                            <View style={styles.actions}>
                              <ControlButton
                                compact
                                disabled={
                                  !accountPassword ||
                                  (!pinEditor.clear &&
                                    !validProfilePIN(pinEditor.pin)) ||
                                  busy
                                }
                                label={
                                  pinEditor.clear ? 'Remove PIN' : 'Save PIN'
                                }
                                onPress={() =>
                                  void run(signal =>
                                    pinEditor.clear
                                      ? client!.clearAccountProfilePIN(
                                          profile.id,
                                          {password: accountPassword},
                                          proof,
                                          {signal},
                                        )
                                      : client!.setAccountProfilePIN(
                                          profile.id,
                                          {
                                            password: accountPassword,
                                            pin: pinEditor.pin,
                                          },
                                          proof,
                                          {signal},
                                        ),
                                  ).then(ok => {
                                    if (ok) {
                                      setPinEditor(undefined);
                                      setAccountPassword('');
                                    }
                                  })
                                }
                                platform="mobile"
                                primary
                              />
                              <ControlButton
                                compact
                                label={productMessageText('action.cancel')}
                                onPress={() => {
                                  setPinEditor(undefined);
                                  setAccountPassword('');
                                }}
                                platform="mobile"
                              />
                            </View>
                          </View>
                        ) : null}
                        {renameEditor?.profileId === profile.id ? (
                          <View style={styles.inlineEditor}>
                            <TextField
                              label="Profile name"
                              onChangeText={name =>
                                setRenameEditor(current =>
                                  current ? {...current, name} : current,
                                )
                              }
                              value={renameEditor.name}
                            />
                            <View style={styles.actions}>
                              <ControlButton
                                compact
                                disabled={
                                  !renameEditor.name.trim() ||
                                  renameEditor.name.trim() === profile.name ||
                                  busy
                                }
                                label="Save name"
                                onPress={() =>
                                  void run(signal =>
                                    client!.updateAccountProfile(
                                      profile.id,
                                      {name: renameEditor.name.trim()},
                                      proof,
                                      {signal},
                                    ),
                                  ).then(ok => {
                                    if (ok) setRenameEditor(undefined);
                                  })
                                }
                                platform="mobile"
                                primary
                              />
                              <ControlButton
                                compact
                                label={productMessageText('action.cancel')}
                                onPress={() => setRenameEditor(undefined)}
                                platform="mobile"
                              />
                            </View>
                          </View>
                        ) : null}
                        {deleting ? (
                          <View style={styles.inlineEditor}>
                            <Text style={styles.description}>
                              {productMessageText(
                                directory.authority === 'hosted'
                                  ? 'profiles.remove-confirmation-hosted'
                                  : 'profiles.remove-confirmation-local',
                                {profileName: profile.name},
                              )}
                            </Text>
                            <View style={styles.actions}>
                              <ControlButton
                                compact
                                disabled={busy}
                                icon="action.delete"
                                label={productMessageText(
                                  'action.remove-profile',
                                )}
                                onPress={() =>
                                  void run(signal =>
                                    client!.deleteAccountProfile(
                                      profile.id,
                                      proof,
                                      {signal},
                                    ),
                                  ).then(ok => {
                                    if (ok) setDeleteProfileId(undefined);
                                  })
                                }
                                platform="mobile"
                                primary
                              />
                              <ControlButton
                                compact
                                label={productMessageText('action.cancel')}
                                onPress={() => setDeleteProfileId(undefined)}
                                platform="mobile"
                              />
                            </View>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function TextField({
  keyboardType,
  label,
  maxLength,
  onChangeText,
  value,
}: {
  keyboardType?: 'number-pad';
  label: string;
  maxLength?: number;
  onChangeText(value: string): void;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        keyboardType={keyboardType}
        maxLength={maxLength}
        onChangeText={onChangeText}
        placeholderTextColor={color.mutedSilver}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function SecretField({
  label,
  onChangeText,
  onToggle,
  revealed,
  value,
}: {
  label: string;
  onChangeText(value: string): void;
  onToggle(): void;
  revealed: boolean;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.secretRow}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onChangeText}
          secureTextEntry={!revealed}
          style={[styles.input, styles.secretInput]}
          value={value}
        />
        <Focusable
          accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
          accessibilityRole="button"
          onPress={onToggle}
          platform="mobile"
          style={styles.reveal}
        >
          <PorticoIcon color={color.softSilver} id={revealed ? 'account.visibility.hide' : 'account.visibility.show'} size={20} />
        </Focusable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,4,8,0.82)',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  panel: {
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '90%',
    maxWidth: 620,
    padding: 18,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: color.screenBlue,
    fontFamily: font.demi,
    fontSize: 12,
    letterSpacing: 1.1,
  },
  title: {
    color: color.silver,
    fontFamily: font.bold,
    fontSize: 27,
    marginTop: 3,
  },
  content: {gap: 18, paddingBottom: 12, paddingTop: 18},
  section: {gap: 12},
  sectionTitle: {color: color.silver, fontFamily: font.demi, fontSize: 18},
  description: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  notice: {
    backgroundColor: color.projector,
    borderColor: color.lineSoft,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  noticeTitle: {color: color.silver, fontFamily: font.demi, fontSize: 17},
  error: {
    alignItems: 'center',
    backgroundColor: color.projector,
    borderColor: color.record,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    padding: 12,
  },
  errorText: {
    color: color.softSilver,
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13,
  },
  field: {gap: 6},
  fieldLabel: {color: color.softSilver, fontFamily: font.medium, fontSize: 13},
  input: {
    backgroundColor: color.projector,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.regular,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  secretRow: {alignItems: 'center', flexDirection: 'row'},
  secretInput: {flex: 1, paddingRight: 52},
  reveal: {
    alignItems: 'center',
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    marginLeft: -46,
    width: 44,
  },
  profileCard: {
    borderColor: color.lineSoft,
    borderRadius: 10,
    borderWidth: 1,
    gap: 12,
    padding: 12,
  },
  profileSummary: {alignItems: 'center', flexDirection: 'row', gap: 10},
  avatar: {
    alignItems: 'center',
    backgroundColor: color.raisedSlate,
    borderRadius: 999,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  profileCopy: {flex: 1},
  profileName: {color: color.silver, fontFamily: font.demi, fontSize: 16},
  profileMeta: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    marginTop: 2,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  inlineEditor: {
    backgroundColor: color.projector,
    borderRadius: 8,
    gap: 10,
    padding: 12,
  },
});
