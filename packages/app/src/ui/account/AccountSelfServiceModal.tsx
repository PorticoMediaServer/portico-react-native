import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {PorticoIcon, type PorticoIconId} from '@portico-react-native/icons';
import {validPorticoUsername, type PorticoDevice} from '@portico/client-core';
import {
  porticoAccountService,
  productErrorMessageId,
  productMessageText,
  type HostedAccount,
  type PorticoAccountMFASetup,
  type PorticoAccountMFAStatus,
} from '@portico-react-native/infrastructure';
import {color, font, mobileType, radius} from '../tokens';
import {ControlButton, IconButton} from '../primitives';
import {useModalAnimationType} from '../useReducedMotion';
import {
  passwordStrengthLabel,
  porticoPasswordStrength,
  validPorticoPassword,
} from '../passwordStrength';

type AuthBridge = {
  accountDeviceId?: string;
  refreshPorticoAccount(): Promise<void>;
  signOut(): Promise<void>;
};

export function AccountSelfServiceModal({
  account,
  auth,
  onClose,
  visible,
}: {
  account: HostedAccount;
  auth: AuthBridge;
  onClose(): void;
  visible: boolean;
}) {
  const animationType = useModalAnimationType('slide');
  const [username, setUsername] = useState(account.username);
  const [email, setEmail] = useState(account.email);
  const [profileImageUrl, setProfileImageUrl] = useState(
    account.profileImageUrl,
  );
  const [mfa, setMFA] = useState<PorticoAccountMFAStatus>();
  const [devices, setDevices] = useState<PorticoDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [setup, setSetup] = useState<PorticoAccountMFASetup>();
  const [setupPassword, setSetupPassword] = useState('');
  const [mfaCode, setMFACode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteMFA, setDeleteMFA] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [confirmDeviceId, setConfirmDeviceId] = useState<string>();

  const loadSecurity = async (signal?: AbortSignal) => {
    setLoading(true);
    setError(undefined);
    try {
      const [nextMFA, nextDevices] = await Promise.all([
        porticoAccountService.mfaStatus(signal),
        porticoAccountService.devices(signal),
      ]);
      setMFA(nextMFA);
      setDevices(nextDevices);
    } catch (cause) {
      if (!signal?.aborted)
        setError(productErrorMessageId(cause, 'problem.request-failed'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) {
      setSetup(undefined);
      setSetupPassword('');
      setMFACode('');
      return;
    }
    setUsername(account.username);
    setEmail(account.email);
    setProfileImageUrl(account.profileImageUrl);
    const controller = new AbortController();
    void loadSecurity(controller.signal);
    return () => controller.abort();
  }, [account.email, account.profileImageUrl, account.username, visible]);

  const run = async (
    key: string,
    operation: () => Promise<void>,
    failure: Parameters<
      typeof productErrorMessageId
    >[1] = 'problem.request-failed',
  ) => {
    setBusy(key);
    setError(undefined);
    setNotice(undefined);
    try {
      await operation();
    } catch (cause) {
      setError(productErrorMessageId(cause, failure));
    } finally {
      setBusy(undefined);
    }
  };

  const saveIdentity = () =>
    run(
      'identity',
      async () => {
        const nextName = username.trim();
        const nextEmail = account.email;
        if (!validPorticoUsername(nextName) || !nextEmail)
          throw new Error('Enter a valid username.');
        const response = await porticoAccountService.updateIdentity({
          username: nextName,
          email: nextEmail,
        });
        setUsername(response.user.username);
        setEmail(response.user.email);
        setProfileImageUrl(response.user.profileImageUrl);
        await auth.refreshPorticoAccount();
        setNotice(productMessageText('account.saved'));
      },
      'account.save-failed',
    );

  const removeImage = () =>
    run(
      'image',
      async () => {
        const response = await porticoAccountService.deleteImage();
        setProfileImageUrl(response.user.profileImageUrl);
        await auth.refreshPorticoAccount();
        setNotice(productMessageText('account.saved'));
      },
      'account.save-failed',
    );

  const changePassword = () =>
    run(
      'password',
      async () => {
        if (
          !currentPassword ||
          !newPassword ||
          newPassword !== confirmPassword
        ) {
          setError('Enter your current password and matching new passwords.');
          return;
        }
        if (!validPorticoPassword(newPassword)) {
          setError(
            'Use at least 8 characters with uppercase, lowercase, and a number or special character.',
          );
          return;
        }
        await porticoAccountService.changePassword({
          currentPassword,
          newPassword,
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setNotice('Your Portico Account password was changed.');
      },
      'account.save-failed',
    );

  const startMFA = () =>
    run('mfa-start', async () => {
      try {
        setSetup(await porticoAccountService.startMFA(setupPassword));
        setSetupPassword('');
        setRecoveryCodes([]);
      } catch (cause) {
        setSetup(undefined);
        setSetupPassword('');
        throw cause;
      }
    });
  const replaceImage = () =>
    run('image', async () => {
      const image = await porticoAccountService.pickImage();
      if (!image) return;
      const user = await porticoAccountService.uploadImage(image);
      setProfileImageUrl(user.profileImageUrl ?? '');
      setNotice('Your account image was updated.');
    });

  const enableMFA = () =>
    run('mfa-enable', async () => {
      if (!mfaCode.trim() || !setup) return;
      try {
        const result = await porticoAccountService.enableMFA({
          code: mfaCode.trim(),
          enrollmentToken: setup.enrollmentToken,
        });
        if (!result.enabled) throw new Error('MFA was not enabled.');
        setRecoveryCodes(result.recoveryCodes);
        setSetup(undefined);
        setMFACode('');
        setMFA(await porticoAccountService.mfaStatus());
        setNotice(
          'Two-factor authentication is now enabled. Save the recovery codes below.',
        );
      } catch (cause) {
        setSetup(undefined);
        setMFACode('');
        throw cause;
      }
    });

  const disableMFA = () =>
    run('mfa-disable', async () => {
      if (!disablePassword || !disableCode.trim()) return;
      await porticoAccountService.disableMFA({
        password: disablePassword,
        code: disableCode.trim(),
      });
      setDisablePassword('');
      setDisableCode('');
      setRecoveryCodes([]);
      setMFA(await porticoAccountService.mfaStatus());
      setNotice('Two-factor authentication was disabled.');
    });

  const revokeDevice = (device: PorticoDevice) =>
    run(`device:${device.id}`, async () => {
      await porticoAccountService.revokeDevice(device.id);
      setDevices(current =>
        current.filter(candidate => candidate.id !== device.id),
      );
      setConfirmDeviceId(undefined);
      setNotice(`${device.name} was signed out.`);
    });

  const deleteAccount = () =>
    run(
      'delete',
      async () => {
        if (deleteConfirmation !== 'DELETE' || !deletePassword) return;
        const verification = deleteMFA.trim();
        await porticoAccountService.deleteAccount({
          password: deletePassword,
          ...(mfa?.enabled
            ? /^\d{6}$/.test(verification)
              ? {mfaCode: verification}
              : {recoveryCode: verification}
            : {}),
        });
        setDeletePassword('');
        await auth.signOut();
      },
      'account.delete-failed',
    );

  const close = () => {
    setSetup(undefined);
    setSetupPassword('');
    setMFACode('');
    onClose();
  };

  return (
    <Modal
      animationType={animationType}
      onRequestClose={close}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <View style={styles.canvas}>
        <View style={styles.header}>
          <View>
            <Text style={mobileType.title}>Portico Account</Text>
            <Text style={styles.headerMeta}>{email}</Text>
          </View>
          <IconButton
            icon="action.close"
            label={productMessageText('action.close')}
            onPress={close}
            platform="mobile"
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          {notice ? (
            <Text accessibilityLiveRegion="polite" style={styles.notice}>
              {notice}
            </Text>
          ) : null}

          <Section icon="account.user" title="Identity">
            <View style={styles.identityRow}>
              {profileImageUrl ? (
                <Image
                  source={{
                    uri: porticoAccountService.imageUrl(profileImageUrl),
                  }}
                  style={styles.avatar}
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{initials(username)}</Text>
                </View>
              )}
              <View style={styles.identityActions}>
                <Text style={styles.supporting}>
                  Your account image follows you across Portico.
                </Text>
                <ControlButton
                  compact
                  disabled={Boolean(busy)}
                  icon="media.photo"
                  label={profileImageUrl ? 'Replace image' : 'Add image'}
                  onPress={replaceImage}
                  platform="mobile"
                />
                {profileImageUrl ? (
                  <ControlButton
                    compact
                    disabled={Boolean(busy)}
                    icon="action.delete"
                    label="Remove image"
                    onPress={removeImage}
                    platform="mobile"
                  />
                ) : null}
              </View>
            </View>
            <Field
              autoCapitalize="none"
              label="Username"
              onChangeText={setUsername}
              value={username}
            />
            <Field
              autoCapitalize="none"
              autoComplete="email"
              editable={false}
              keyboardType="email-address"
              label="Email"
              onChangeText={setEmail}
              value={email}
            />
            <Text style={styles.supporting}>
              This email identifies your Portico Account and receives account
              recovery messages.
            </Text>
            <ControlButton
              disabled={
                Boolean(busy) ||
                !validPorticoUsername(username) ||
                !email.trim()
              }
              label={
                busy === 'identity'
                  ? productMessageText('action.saving')
                  : productMessageText('action.save-changes')
              }
              onPress={saveIdentity}
              platform="mobile"
              primary
            />
          </Section>

          <Section icon="account.security" title="Password">
            <SecretField
              label="Current password"
              onChangeText={setCurrentPassword}
              value={currentPassword}
            />
            <SecretField
              label="New password"
              onChangeText={setNewPassword}
              value={newPassword}
            />
            <Text style={styles.supporting}>
              Use at least 8 characters with uppercase, lowercase, and a number
              or special character.
            </Text>
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.passwordStrength,
                porticoPasswordStrength(newPassword) === 'Medium' &&
                  styles.passwordStrengthMedium,
                porticoPasswordStrength(newPassword) === 'Strong' &&
                  styles.passwordStrengthStrong,
              ]}
            >
              Strength:{' '}
              {passwordStrengthLabel(porticoPasswordStrength(newPassword))}
            </Text>
            <SecretField
              label="Confirm new password"
              onChangeText={setConfirmPassword}
              value={confirmPassword}
            />
            <ControlButton
              disabled={
                Boolean(busy) ||
                !currentPassword ||
                !newPassword ||
                newPassword !== confirmPassword
              }
              label={busy === 'password' ? 'Changing…' : 'Change password'}
              onPress={changePassword}
              platform="mobile"
            />
          </Section>

          <Section icon="account.verified" title="Two-factor authentication">
            {loading && !mfa ? (
              <ActivityIndicator color={color.screenBlue} />
            ) : (
              <Text style={styles.securityState}>
                {mfa?.enabled ? 'On' : 'Off'}
                {mfa?.recoveryCodesRemaining !== undefined && mfa.enabled
                  ? ` · ${mfa.recoveryCodesRemaining} recovery codes remaining`
                  : ''}
              </Text>
            )}
            {!mfa?.enabled && !setup ? (
              <View style={styles.formStack}>
                <Text style={styles.supporting}>
                  Confirm your Portico Account password to begin setup.
                </Text>
                <SecretField
                  label="Current password for authenticator setup"
                  onChangeText={setSetupPassword}
                  value={setupPassword}
                />
                <ControlButton
                  disabled={Boolean(busy) || loading || !setupPassword}
                  label="Set up authenticator"
                  onPress={startMFA}
                  platform="mobile"
                />
              </View>
            ) : null}
            {setup ? (
              <View style={styles.setupBox}>
                <Text style={styles.supporting}>
                  Add this secret to your authenticator app, then enter its
                  current code.
                </Text>
                <Text selectable style={styles.secret}>
                  {setup.secret}
                </Text>
                <Text selectable style={styles.setupUrl}>
                  {setup.otpauthUrl}
                </Text>
                <Field
                  autoComplete="one-time-code"
                  keyboardType="number-pad"
                  label="Authenticator code"
                  onChangeText={setMFACode}
                  value={mfaCode}
                />
                <ControlButton
                  disabled={Boolean(busy)}
                  label="Cancel authenticator setup"
                  onPress={() => {
                    setSetup(undefined);
                    setMFACode('');
                  }}
                  platform="mobile"
                />
                <ControlButton
                  disabled={Boolean(busy) || !mfaCode.trim()}
                  label="Enable two-factor authentication"
                  onPress={enableMFA}
                  platform="mobile"
                  primary
                />
              </View>
            ) : null}
            {recoveryCodes.length ? (
              <View style={styles.recoveryBox}>
                <Text style={styles.recoveryTitle}>
                  Recovery codes — save these now
                </Text>
                {recoveryCodes.map(code => (
                  <Text key={code} selectable style={styles.recoveryCode}>
                    {code}
                  </Text>
                ))}
              </View>
            ) : null}
            {mfa?.enabled ? (
              <View style={styles.formStack}>
                <Text style={styles.supporting}>
                  Disabling protection requires your password and a current
                  authenticator or recovery code.
                </Text>
                <SecretField
                  label="Current password"
                  onChangeText={setDisablePassword}
                  value={disablePassword}
                />
                <Field
                  autoCapitalize="none"
                  autoComplete="one-time-code"
                  label="Authenticator or recovery code"
                  onChangeText={setDisableCode}
                  value={disableCode}
                />
                <ControlButton
                  disabled={
                    Boolean(busy) || !disablePassword || !disableCode.trim()
                  }
                  label="Disable two-factor authentication"
                  onPress={disableMFA}
                  platform="mobile"
                />
              </View>
            ) : null}
          </Section>

          <Section icon="device.client" title="Signed-in devices">
            <Text style={styles.supporting}>
              Revoking a device signs out every Portico Account session issued
              to that device.
            </Text>
            {loading ? (
              <ActivityIndicator color={color.screenBlue} />
            ) : (
              devices.map(device => {
                const current = device.id === auth.accountDeviceId;
                return (
                  <View key={device.id} style={styles.deviceRow}>
                    <View style={styles.deviceCopy}>
                      <Text style={styles.deviceName}>
                        {device.name}
                        {current ? ' · This device' : ''}
                      </Text>
                      <Text style={styles.deviceMeta}>
                        {device.platform} · Seen {formatDate(device.lastSeenAt)}
                      </Text>
                    </View>
                    {!current && confirmDeviceId !== device.id ? (
                      <ControlButton
                        compact
                        disabled={Boolean(busy)}
                        label="Review"
                        onPress={() => setConfirmDeviceId(device.id)}
                        platform="mobile"
                      />
                    ) : null}
                    {!current && confirmDeviceId === device.id ? (
                      <View style={styles.deviceConfirm}>
                        <ControlButton
                          compact
                          disabled={Boolean(busy)}
                          label="Cancel"
                          onPress={() => setConfirmDeviceId(undefined)}
                          platform="mobile"
                        />
                        <ControlButton
                          compact
                          disabled={Boolean(busy)}
                          label={
                            busy === `device:${device.id}`
                              ? 'Revoking…'
                              : 'Confirm revoke'
                          }
                          onPress={() => revokeDevice(device)}
                          platform="mobile"
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
            {!loading && !devices.length ? (
              <Text style={styles.supporting}>
                No active account devices were returned.
              </Text>
            ) : null}
          </Section>

          <Section danger icon="status.locked" title="Delete account">
            <Text style={styles.supporting}>
              {productMessageText('account.delete-description')}
            </Text>
            <Text style={styles.warning}>
              {productMessageText('account.delete-ready')}
            </Text>
            <Field
              autoCapitalize="characters"
              label={productMessageText('account.delete-confirmation')}
              onChangeText={setDeleteConfirmation}
              value={deleteConfirmation}
            />
            <SecretField
              label={productMessageText('account.delete-password-label')}
              onChangeText={setDeletePassword}
              value={deletePassword}
            />
            {mfa?.enabled ? (
              <Field
                autoCapitalize="none"
                autoComplete="one-time-code"
                label={productMessageText('account.delete-mfa-label')}
                onChangeText={setDeleteMFA}
                value={deleteMFA}
              />
            ) : null}
            <ControlButton
              disabled={
                Boolean(busy) ||
                deleteConfirmation !== 'DELETE' ||
                !deletePassword ||
                Boolean(mfa?.enabled && !deleteMFA.trim())
              }
              icon="action.delete"
              label={
                busy === 'delete'
                  ? productMessageText('action.deleting-account')
                  : productMessageText('action.delete-account')
              }
              onPress={deleteAccount}
              platform="mobile"
            />
          </Section>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({
  children,
  danger,
  icon,
  title,
}: {
  children: React.ReactNode;
  danger?: boolean;
  icon: PorticoIconId;
  title: string;
}) {
  return (
    <View style={[styles.section, danger && styles.dangerSection]}>
      <View style={styles.sectionHeading}>
        <PorticoIcon color={danger ? color.record : color.screenBlueStrong} id={icon} size={20} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Field(
  props: React.ComponentProps<typeof TextInput> & {label: string},
) {
  const labelId = React.useId();
  const {label, ...inputProps} = props;
  return (
    <View style={styles.field}>
      <Text nativeID={labelId} style={styles.fieldLabel}>
        {label}
      </Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        accessibilityLabelledBy={labelId}
        placeholderTextColor={color.mutedSilver}
        style={styles.input}
      />
    </View>
  );
}

function SecretField(
  props: Omit<React.ComponentProps<typeof TextInput>, 'secureTextEntry'> & {
    label: string;
  },
) {
  const [visible, setVisible] = useState(false);
  const labelId = React.useId();
  const {label, ...inputProps} = props;
  return (
    <View style={styles.field}>
      <Text nativeID={labelId} style={styles.fieldLabel}>
        {label}
      </Text>
      <View style={styles.secretField}>
        <TextInput
          {...inputProps}
          accessibilityLabel={label}
          accessibilityLabelledBy={labelId}
          autoCapitalize="none"
          autoComplete="password"
          placeholderTextColor={color.mutedSilver}
          secureTextEntry={!visible}
          style={[styles.input, styles.secretInput]}
        />
        <Pressable
          accessibilityLabel={`${productMessageText(visible ? 'auth.password.hide' : 'auth.password.show')}: ${label}`}
          accessibilityRole="button"
          accessibilityState={{expanded: visible}}
          disabled={inputProps.editable === false}
          hitSlop={8}
          onPress={() => setVisible(current => !current)}
          style={({pressed}) => [
            styles.secretVisibility,
            pressed && styles.secretVisibilityPressed,
          ]}
        >
          <PorticoIcon color={color.softSilver} id={visible ? 'account.visibility.hide' : 'account.visibility.show'} size={18} />
        </Pressable>
      </View>
    </View>
  );
}

function initials(value: string): string {
  return (
    value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join('') || 'P'
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'recently' : date.toLocaleDateString();
}

const styles = StyleSheet.create({
  canvas: {backgroundColor: color.projector, flex: 1},
  header: {
    alignItems: 'center',
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  headerMeta: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    marginTop: 2,
  },
  content: {gap: 18, padding: 16, paddingBottom: 64},
  error: {
    backgroundColor: 'rgba(237,91,103,0.10)',
    borderColor: 'rgba(237,91,103,0.35)',
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.medium,
    fontSize: 13,
    padding: 12,
  },
  notice: {
    backgroundColor: 'rgba(98,201,167,0.10)',
    borderColor: 'rgba(98,201,167,0.32)',
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.medium,
    fontSize: 13,
    padding: 12,
  },
  section: {
    backgroundColor: color.recess,
    borderColor: color.lineSoft,
    borderRadius: radius.surface,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dangerSection: {borderColor: 'rgba(237,91,103,0.28)'},
  sectionHeading: {
    alignItems: 'center',
    borderBottomColor: color.lineSoft,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 14,
  },
  sectionTitle: {color: color.silver, fontFamily: font.demi, fontSize: 18},
  sectionBody: {gap: 12, padding: 14},
  identityRow: {alignItems: 'center', flexDirection: 'row', gap: 14},
  identityActions: {alignItems: 'flex-start', flex: 1, gap: 8},
  avatar: {borderRadius: 34, height: 68, width: 68},
  avatarFallback: {
    alignItems: 'center',
    backgroundColor: color.screenBlueDeep,
    borderRadius: 34,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  avatarInitial: {color: color.silver, fontFamily: font.bold, fontSize: 22},
  supporting: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  passwordStrength: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 13,
  },
  passwordStrengthMedium: {color: color.tunerAmber},
  passwordStrengthStrong: {color: color.healthy},
  securityState: {color: color.healthy, fontFamily: font.demi, fontSize: 15},
  formStack: {gap: 12},
  field: {gap: 6},
  fieldLabel: {color: color.softSilver, fontFamily: font.medium, fontSize: 12},
  input: {
    backgroundColor: color.projector,
    borderColor: color.lineStrong,
    borderRadius: radius.control,
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.regular,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secretField: {position: 'relative'},
  secretInput: {paddingRight: 50},
  secretVisibility: {
    alignItems: 'center',
    height: 38,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    top: 4,
    width: 40,
  },
  secretVisibilityPressed: {opacity: 0.68},
  setupBox: {backgroundColor: color.slate, gap: 10, padding: 12},
  secret: {
    color: color.screenBlueStrong,
    fontFamily: font.bold,
    fontSize: 18,
    letterSpacing: 1.2,
  },
  setupUrl: {color: color.mutedSilver, fontFamily: font.regular, fontSize: 10},
  recoveryBox: {backgroundColor: color.slate, gap: 4, padding: 12},
  recoveryTitle: {
    color: color.tunerAmber,
    fontFamily: font.demi,
    fontSize: 14,
    marginBottom: 5,
  },
  recoveryCode: {
    color: color.silver,
    fontFamily: font.medium,
    fontSize: 15,
    letterSpacing: 1,
  },
  deviceRow: {
    alignItems: 'center',
    borderTopColor: color.lineSoft,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    paddingTop: 12,
  },
  deviceCopy: {flex: 1},
  deviceConfirm: {alignItems: 'center', flexDirection: 'row', gap: 6},
  deviceName: {color: color.silver, fontFamily: font.demi, fontSize: 14},
  deviceMeta: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 11,
    marginTop: 2,
  },
  warning: {
    color: color.tunerAmber,
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 19,
  },
});
