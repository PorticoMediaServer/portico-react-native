import type {PorticoAccountUser, PorticoDevice} from '@portico/client-core';
import {hostedClient} from './clientEnvironment';
import {NativeModules} from 'react-native';

export interface PorticoPickedImage {uri: string; name: string; type: string}

export function createAccountImageOperations(
  picker: {pickImage?(): Promise<PorticoPickedImage | null>} | undefined,
  client: {uploadAccountImage(form: FormData): Promise<{user: unknown}>},
) {
  return {
    async pickImage(): Promise<PorticoPickedImage | undefined> {
      if (!picker?.pickImage) return undefined;
      return (await picker.pickImage()) ?? undefined;
    },
    async uploadImage(image: PorticoPickedImage): Promise<PorticoAccountUser> {
      const form = new FormData();
      form.append('file', image as unknown as Blob);
      const response = await client.uploadAccountImage(form);
      return response.user as PorticoAccountUser;
    },
  };
}

const accountImageOperations = createAccountImageOperations(
  NativeModules.PorticoImagePicker as {pickImage?(): Promise<PorticoPickedImage | null>} | undefined,
  hostedClient,
);

export interface PorticoAccountMFAStatus {
  enabled: boolean;
  recoveryCodesRemaining?: number;
  recoveryCodesSupported: boolean;
  setupStarted: boolean;
}

export interface PorticoAccountMFASetup {
  enrollmentToken: string;
  otpauthUrl: string;
  secret: string;
}

export interface PorticoAccountMFAEnableResult {
  enabled: boolean;
  recoveryCodes: string[];
}

function request<T>(path: string, init: {body?: unknown; method?: string; signal?: AbortSignal} = {}): Promise<T> {
  return hostedClient.request<T>(path, init);
}

export const porticoAccountService = {
  imageUrl(value: string) {
    const path = value.trim();
    return /^https?:\/\//i.test(path) ? path : hostedClient.hostedApiUrl(path);
  },

  updateIdentity(body: {username: string; email: string}, signal?: AbortSignal) {
    return request<{user: PorticoAccountUser}>('/api/account/me', {body, method: 'PATCH', signal});
  },

  pickImage: accountImageOperations.pickImage,
  uploadImage: accountImageOperations.uploadImage,

  deleteImage(signal?: AbortSignal) {
    return request<{user: PorticoAccountUser}>('/api/account/me/image', {method: 'DELETE', signal});
  },

  changePassword(body: {currentPassword: string; newPassword: string}, signal?: AbortSignal) {
    return request<{ok: boolean}>('/api/account/me/password', {body, method: 'POST', signal});
  },

  async mfaStatus(signal?: AbortSignal): Promise<PorticoAccountMFAStatus> {
    const source = await request<Record<string, unknown>>('/api/auth/mfa/status', {signal});
    const remaining = typeof source.recoveryCodesRemaining === 'number' && Number.isFinite(source.recoveryCodesRemaining)
      ? Math.max(0, Math.trunc(source.recoveryCodesRemaining))
      : undefined;
    return {
      enabled: source.enabled === true,
      recoveryCodesRemaining: remaining,
      recoveryCodesSupported: source.recoveryCodesSupported !== false,
      setupStarted: source.setupStarted === true,
    };
  },

  async startMFA(password: string, signal?: AbortSignal): Promise<PorticoAccountMFASetup> {
    const source = await request<Record<string, unknown>>('/api/auth/mfa/setup', {body: {password}, method: 'POST', signal});
    const secret = typeof source.secret === 'string' ? source.secret.trim() : '';
    const otpauthUrl = typeof source.otpauthUrl === 'string' ? source.otpauthUrl.trim() : '';
    const enrollmentToken = typeof source.enrollmentToken === 'string' ? source.enrollmentToken.trim() : '';
    if (!secret || !otpauthUrl || !enrollmentToken) throw new Error('Incomplete authenticator setup response.');
    return {enrollmentToken, otpauthUrl, secret};
  },

  async enableMFA(input: {code: string; enrollmentToken: string}, signal?: AbortSignal): Promise<PorticoAccountMFAEnableResult> {
    const source = await request<Record<string, unknown>>('/api/auth/mfa/enable', {body: input, method: 'POST', signal});
    return {
      enabled: source.enabled === true,
      recoveryCodes: Array.isArray(source.recoveryCodes)
        ? source.recoveryCodes.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        : [],
    };
  },

  disableMFA(body: {password: string; code: string}, signal?: AbortSignal) {
    return request<{ok: boolean}>('/api/auth/mfa/disable', {body, method: 'POST', signal});
  },

  async devices(signal?: AbortSignal): Promise<PorticoDevice[]> {
    const response = await request<{items: PorticoDevice[]}>('/api/account/devices?limit=100', {signal});
    return response.items.filter(device => !device.revokedAt);
  },

  revokeDevice(deviceId: string, signal?: AbortSignal) {
    return request<{ok: boolean}>(`/api/account/devices/${encodeURIComponent(deviceId)}`, {method: 'DELETE', signal});
  },

  deleteAccount(body: {password: string; mfaCode?: string; recoveryCode?: string}, signal?: AbortSignal) {
    return request<{deletedAt: string; ok: boolean}>('/api/account/me', {body, method: 'DELETE', signal});
  },
};
