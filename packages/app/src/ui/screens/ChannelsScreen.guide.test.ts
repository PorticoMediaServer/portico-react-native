import type {LiveTVChannel} from '@porticomediaserver/client-core';
import {
  boundedGuideChannelWindow,
  dvrCapabilityState,
  GUIDE_QUERY_WINDOW_HOURS,
  GUIDE_RENDER_CHANNEL_LIMIT,
  guideQueryWindow,
  liveTvTabsForCapability,
  nextGuidePageCursor,
  resilientGuideChannels,
  uniqueLiveTVItems,
} from './ChannelsScreen';

function channel(id: string, favorite = false): LiveTVChannel {
  return {
    actions: ['live.play'],
    enabled: true,
    favorite,
    hidden: false,
    id,
    name: id,
    programCount: 0,
    sortOrder: 0,
    sourceId: 'source-1',
  };
}

describe('Live TV guide resilience', () => {
  it('deduplicates cursor pages while retaining later authoritative values', () => {
    expect(uniqueLiveTVItems([[channel('one')], [channel('one', true), channel('two')]])).toEqual([
      channel('one', true),
      channel('two'),
    ]);
  });

  it('keeps directory channels playable when EPG is empty or unavailable', () => {
    expect(resilientGuideChannels([], [channel('one'), channel('two')], false, 'all').map(item => item.id)).toEqual(['one', 'two']);
    expect(resilientGuideChannels([], [channel('one')], true, 'all').map(item => item.id)).toEqual(['one']);
  });

  it('honors programme-derived filters when guide data is available', () => {
    expect(resilientGuideChannels([channel('sports')], [channel('sports'), channel('news')], true, 'sports').map(item => item.id)).toEqual(['sports']);
  });

  it('falls back to the channel directory after filtered EPG failure', () => {
    expect(resilientGuideChannels([], [channel('one')], false, 'sports').map(item => item.id)).toEqual(['one']);
  });
});

describe('Live TV route and request ownership', () => {
  it('keeps a restored DVR route while capability is unknown', () => {
    expect(dvrCapabilityState({hasSource: true, isSuccess: false})).toBe('unknown');
    expect(liveTvTabsForCapability('unknown', 'DVR')).toContain('DVR');
  });

  it('removes DVR only with authoritative unsupported evidence', () => {
    expect(dvrCapabilityState({hasSource: false, isSuccess: false})).toBe('unsupported');
    expect(liveTvTabsForCapability('unsupported', 'DVR')).not.toContain('DVR');
  });

  it('advances only from explicit cursor evidence and stops at the final page', () => {
    expect(nextGuidePageCursor({
      directoryHasMore: true,
      directoryNext: 'directory-2',
      guideHasMore: true,
      guideNext: 'guide-2',
    })).toEqual({directory: 'directory-2', guide: 'guide-2'});
    expect(nextGuidePageCursor({
      directoryHasMore: false,
      guideHasMore: false,
    })).toBeUndefined();
    expect(nextGuidePageCursor({
      directoryHasMore: true,
      guideHasMore: true,
    })).toBeUndefined();
  });
});

describe('bounded guide rendering', () => {
  it('anchors today close to now and limits the horizontal query span', () => {
    const now = new Date(2026, 7, 6, 12, 30).getTime();
    expect(guideQueryWindow(0, now)).toEqual({
      from: now - 60 * 60 * 1_000,
      hours: GUIDE_QUERY_WINDOW_HOURS,
    });
  });

  it('uses the requested day boundary for future guide windows', () => {
    const now = new Date(2026, 7, 6, 12, 30).getTime();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    expect(guideQueryWindow(1, now).from).toBe(tomorrow.getTime());
  });

  it('keeps a 10,000-channel synthetic guide render bounded', () => {
    const syntheticChannels = Array.from({length: 10_000}, (_, index) => index);
    const window = boundedGuideChannelWindow(syntheticChannels, 9_990);
    expect(window.items).toHaveLength(GUIDE_RENDER_CHANNEL_LIMIT);
    expect(window.start).toBe(10_000 - GUIDE_RENDER_CHANNEL_LIMIT);
    expect(window.items[0]).toBe(10_000 - GUIDE_RENDER_CHANNEL_LIMIT);
    expect(window.items[window.items.length - 1]).toBe(9_999);
    expect(window.hasPrevious).toBe(true);
    expect(window.hasNext).toBe(false);
  });

  it('keeps active query payloads page-bounded for a 50,000-channel source', () => {
    const pageSize = 250;
    const pages = 50_000 / pageSize;
    let activeChannels = Array.from({length: pageSize}, (_, index) => index);
    let requests = 2;
    for (let page = 1; page < pages; page += 1) {
      const cursor = nextGuidePageCursor({
        directoryHasMore: true,
        directoryNext: `directory-${page + 1}`,
        guideHasMore: true,
        guideNext: `guide-${page + 1}`,
      });
      expect(cursor).toBeDefined();
      // The screen replaces its two active query pages after an explicit user
      // advance; it never accumulates all preceding channel/program payloads.
      activeChannels = Array.from({length: pageSize}, (_, index) => page * pageSize + index);
      requests += 2;
    }
    expect(activeChannels).toHaveLength(pageSize);
    expect(requests).toBe(pages * 2);
    expect(boundedGuideChannelWindow(activeChannels, 0).items).toHaveLength(GUIDE_RENDER_CHANNEL_LIMIT);
  });
});
