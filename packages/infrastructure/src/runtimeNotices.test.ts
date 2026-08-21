import {
  dismissRuntimeNotice,
  publishRuntimeNotice,
  runtimeNoticeTestHooks,
} from './runtimeNotices';

beforeEach(() => runtimeNoticeTestHooks.clear());

test('runtime notices coexist, deduplicate, and dismiss independently', () => {
  publishRuntimeNotice('preferences', 'preferences.request-failed');
  publishRuntimeNotice('connection', 'connection.not-saved');
  publishRuntimeNotice('preferences', 'preferences.request-failed');

  expect(runtimeNoticeTestHooks.snapshot().map(notice => notice.id).sort()).toEqual([
    'connection',
    'preferences',
  ]);

  dismissRuntimeNotice('preferences');
  expect(runtimeNoticeTestHooks.snapshot().map(notice => notice.id)).toEqual([
    'connection',
  ]);
});
