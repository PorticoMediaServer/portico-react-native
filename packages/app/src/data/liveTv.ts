import type {DVRRecording, LiveTVChannel, LiveTVProgram} from '@portico/client-core';

export function programsByChannel(programs: LiveTVProgram[]): Map<string, LiveTVProgram[]> {
  const grouped = new Map<string, LiveTVProgram[]>();
  for (const program of programs) {
    if (!program.channelId) continue;
    const channelPrograms = grouped.get(program.channelId) ?? [];
    channelPrograms.push(program);
    grouped.set(program.channelId, channelPrograms);
  }
  for (const channelPrograms of grouped.values()) {
    channelPrograms.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  }
  return grouped;
}

export function currentProgram(programs: LiveTVProgram[], now = Date.now()): LiveTVProgram | undefined {
  return programs.find(program => Date.parse(program.startAt) <= now && Date.parse(program.endAt) > now) ?? programs[0];
}

export function channelMark(channel: LiveTVChannel): string {
  const words = channel.name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map(word => word[0]).join('') : channel.name.slice(0, 3)).toUpperCase();
}

export function channelColor(id: string): string {
  const colors = ['#126D9A', '#6449A5', '#8A4D36', '#276E61', '#7B5E20', '#425A78'];
  const hash = [...id].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 0);
  return colors[hash % colors.length]!;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
}

export function completedRecordings(recordings: DVRRecording[]): DVRRecording[] {
  return recordings.filter(recording => recording.status === 'complete');
}
