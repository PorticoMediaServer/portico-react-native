import {
  activeQueueAvailability,
  addMediaToActiveQueue,
  addMediaToDetailTarget,
  createDetailTarget,
  detailMenuCapabilities,
  editableDetailTargets,
} from './detailActions';

describe('detail consumer actions', () => {
  it('derives only published consumer menu capabilities', () => {
    expect(detailMenuCapabilities(['rating.set', 'playlist.add', 'metadata.edit'])).toEqual({
      collection: false,
      playlist: true,
      queue: false,
      rating: true,
      reaction: false,
    });
  });

  it('returns only editable saved targets', async () => {
    const playlists = jest.fn().mockResolvedValue({
      items: [
        {id: 'editable', canEdit: true},
        {id: 'shared-readonly', canEdit: false},
      ],
    });
    await expect(editableDetailTargets({playlists} as never, 'playlist')).resolves.toEqual([{id: 'editable', canEdit: true}]);
  });

  it('adds media using optimistic saved-resource revisions', async () => {
    const mutatePlaylistItems = jest.fn().mockResolvedValue({});
    const target = {canEdit: true, id: 'playlist-1', updatedAt: '2026-07-13T00:00:00Z'};
    await addMediaToDetailTarget({mutatePlaylistItems} as never, 'playlist', target as never, 'media-1');
    expect(mutatePlaylistItems).toHaveBeenCalledWith('playlist-1', {
      addMediaIds: ['media-1'],
      expectedUpdatedAt: '2026-07-13T00:00:00Z',
    });
  });

  it('creates private saved resources with the media item already included', async () => {
    const createCollection = jest.fn().mockResolvedValue({id: 'collection-1', title: 'Noir'});
    await createDetailTarget({createCollection} as never, 'collection', '  Noir  ', 'media-1');
    expect(createCollection).toHaveBeenCalledWith({mediaIds: ['media-1'], title: 'Noir', visibility: 'private'});
  });

  it('reports an active queue only when it is mutable', async () => {
    const restoreActivePlayback = jest.fn().mockResolvedValue({active: true, playback: {sessionId: 'session-1'}});
    const playbackSessionQueue = jest.fn().mockResolvedValue({canMutate: true, current: {id: 'playing'}});
    await expect(activeQueueAvailability({restoreActivePlayback, playbackSessionQueue} as never)).resolves.toEqual({
      available: true,
      currentMediaId: 'playing',
      sessionId: 'session-1',
    });
  });

  it('uses the authoritative queue revision for play-next', async () => {
    const restoreActivePlayback = jest.fn().mockResolvedValue({active: true, playback: {sessionId: 'session-1'}});
    const playbackSessionQueue = jest.fn().mockResolvedValue({canMutate: true, current: {id: 'playing'}, revision: 7});
    const mutatePlaybackSessionQueue = jest.fn().mockResolvedValue({});
    await addMediaToActiveQueue({restoreActivePlayback, playbackSessionQueue, mutatePlaybackSessionQueue} as never, 'media-1', 'play_next');
    expect(mutatePlaybackSessionQueue).toHaveBeenCalledWith('session-1', {
      action: 'play_next',
      expectedRevision: 7,
      mediaId: 'media-1',
    });
  });
});
