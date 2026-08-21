jest.mock('./clientEnvironment', () => ({
  hostedClient: {
    hostedApiUrl: (path: string) => `https://api.getportico.tv${path}`,
    request: jest.fn(),
    uploadAccountImage: jest.fn(),
  },
}));

import {hostedClient} from './clientEnvironment';
import {createAccountImageOperations, porticoAccountService} from './account';

const mockHostedRequest = hostedClient.request as jest.Mock;

const mockPickImage = jest.fn();
const mockUploadAccountImage = jest.fn();
const operations = createAccountImageOperations({pickImage: mockPickImage}, {uploadAccountImage: mockUploadAccountImage});

beforeEach(() => { mockPickImage.mockReset(); mockUploadAccountImage.mockReset(); mockHostedRequest.mockReset(); });

test('returns a native-picked image without manufacturing file metadata', async () => {
  const image = {uri: 'file:///tmp/avatar.jpg', name: 'avatar.jpg', type: 'image/jpeg'};
  mockPickImage.mockResolvedValue(image);
  await expect(operations.pickImage()).resolves.toEqual(image);
});

test('uploads the selected image through the authenticated hosted form endpoint', async () => {
  const user = {id: 'account-1', username: 'alex', email: 'alex@example.test'};
  mockUploadAccountImage.mockResolvedValue({user});
  await expect(operations.uploadImage({uri: 'file:///tmp/avatar.jpg', name: 'avatar.jpg', type: 'image/jpeg'})).resolves.toEqual(user);
  expect(mockUploadAccountImage).toHaveBeenCalledWith(expect.any(FormData));
});

test('keeps MFA enrollment step-up material in the request flow', async () => {
  mockHostedRequest
    .mockResolvedValueOnce({enrollmentToken: 'short-lived-token', otpauthUrl: 'otpauth://totp/Portico:test?secret=SETUPKEY', secret: 'SETUPKEY'})
    .mockResolvedValueOnce({enabled: true, recoveryCodes: ['one', 'two']});

  await expect(porticoAccountService.startMFA('current-password')).resolves.toEqual({
    enrollmentToken: 'short-lived-token',
    otpauthUrl: 'otpauth://totp/Portico:test?secret=SETUPKEY',
    secret: 'SETUPKEY',
  });
  await expect(porticoAccountService.enableMFA({code: '123456', enrollmentToken: 'short-lived-token'})).resolves.toEqual({enabled: true, recoveryCodes: ['one', 'two']});

  expect(mockHostedRequest).toHaveBeenNthCalledWith(1, '/api/auth/mfa/setup', {body: {password: 'current-password'}, method: 'POST', signal: undefined});
  expect(mockHostedRequest).toHaveBeenNthCalledWith(2, '/api/auth/mfa/enable', {body: {code: '123456', enrollmentToken: 'short-lived-token'}, method: 'POST', signal: undefined});
});
