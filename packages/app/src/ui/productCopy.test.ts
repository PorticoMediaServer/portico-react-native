import {
  productBody,
  productErrorBody,
  productText,
  productTitle,
} from './productCopy';

describe('canonical product copy', () => {
  it('renders text and structured presentations with variables', () => {
    expect(productText('action.forward-seconds', {seconds: 15})).toBe(
      'Forward 15 seconds',
    );
    expect(productTitle('watch-with-friends.reconnecting')).toBe(
      'Reconnecting to the group',
    );
    expect(productBody('download.batch-started', {accepted: 2, rejected: 1})).toBe(
      '2 items were added to the queue. 1 could not be prepared.',
    );
  });

  it('resolves API problem codes before using the canonical fallback', () => {
    expect(
      productErrorBody(
        {code: 'watch_with_friends_revision_conflict', status: 409},
        'watch-with-friends.command-failed',
      ),
    ).toBe("Portico kept the host's newest playback state. Your controls will refresh automatically.");
    expect(productErrorBody(new Error('private transport detail'), 'download.failed')).toBe(
      "Portico couldn't hand this file to your browser. Try again.",
    );
  });

  it('never returns an unresolved catalog token to first-party UI', () => {
    expect(productText('feedback.heading.report-media')).not.toMatch(/\{[A-Za-z][A-Za-z0-9]*\}/);
    expect(productText('feedback.privacy')).not.toMatch(/\{[A-Za-z][A-Za-z0-9]*\}/);
    expect(productText('feedback.heading.report-media', {mediaTitle: 'The Long Night'})).toBe(
      'Report a problem with The Long Night',
    );
    expect(productText('feedback.privacy', {retentionDays: 30})).toContain('30 days');
  });
});
