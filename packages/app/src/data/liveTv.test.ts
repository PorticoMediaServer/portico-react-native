import type {DVRRecording, LiveTVChannel, LiveTVProgram} from '@portico/client-core';
import {channelMark, completedRecordings, currentProgram, programsByChannel} from './liveTv';

test('guide programs are grouped and ordered by their real channel identity', () => {
  const later = {id: 'later', channelId: 'one', startAt: '2026-01-01T11:00:00Z', endAt: '2026-01-01T12:00:00Z'} as LiveTVProgram;
  const now = {id: 'now', channelId: 'one', startAt: '2026-01-01T10:00:00Z', endAt: '2026-01-01T11:00:00Z'} as LiveTVProgram;
  expect(programsByChannel([later, now]).get('one')?.map(program => program.id)).toEqual(['now', 'later']);
  expect(currentProgram([now, later], Date.parse('2026-01-01T10:30:00Z'))?.id).toBe('now');
});

test('channel marks and completed DVR filtering derive from server data', () => {
  expect(channelMark({name: 'Atlantic News', id: 'one'} as LiveTVChannel)).toBe('AN');
  const recordings = [{id: 'a', status: 'scheduled'}, {id: 'b', status: 'complete'}] as DVRRecording[];
  expect(completedRecordings(recordings).map(recording => recording.id)).toEqual(['b']);
});
