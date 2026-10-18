import React, {useState} from 'react';
import {TVFocusGuideView, View} from 'react-native';
import {useI18n} from '../../app/i18n';
import {Button, Field, Menu, Sheet, Tabs, Text, useTheme, type MenuItem} from '../../ui';

export type SeasonChoice = {id: string; label: string; number?: number};

/** Spec §2: tabs for up to 8 seasons, a dropdown beyond that; "Jump to" when a show is very long. */
const TAB_LIMIT = 8;
/** Beyond this many seasons (long-running and daily shows) the season number can be typed. */
const JUMP_SEASONS = 30;
/** Beyond this many episodes in one season, an episode number can be typed. */
const JUMP_EPISODES = 100;

/**
 * The season switcher. The season is state, not a page: choosing one swaps the episode list
 * below and never reloads the hero. Its "⋯" holds the season's own actions (Play season, Mark
 * season as watched/unwatched), and the season's progress sits beside it.
 */
export function SeasonSwitcher({choices, selected, onSelect, seasonActions, onSeasonAction, episodeTotal, onJumpToEpisode, progress}: {
  choices: readonly SeasonChoice[];
  selected: string | undefined;
  onSelect: (id: string) => void;
  seasonActions: readonly MenuItem[];
  onSeasonAction: (id: string) => void;
  episodeTotal?: number;
  onJumpToEpisode: (position: number) => void;
  /** "6 of 10 watched", beside the switcher. */
  progress?: string;
}) {
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const [picking, setPicking] = useState(false);
  const [options, setOptions] = useState(false);
  const [jumping, setJumping] = useState(false);
  const current = choices.find(c => c.id === selected);
  const numbered = choices.filter(c => c.number !== undefined && c.number > 0);
  const jumpSeasons = numbered.length > JUMP_SEASONS;
  const jumpEpisodes = (episodeTotal ?? 0) > JUMP_EPISODES;
  const tabs = choices.length > 1 && choices.length <= TAB_LIMIT;
  const heading = current?.label ?? i18n.t('title.episodes');
  // TV: one guide across the full width, so Up from any episode card reaches the switcher (not
  // only from the cards that happen to sit under a control), landing on the last control used.
  const Row = isTV ? TVFocusGuideView : View;
  return (
    <Row {...(isTV ? {autoFocus: true} : null)} style={{marginBottom: isTV ? space.md : space.sm}}>
      {tabs ? (
        <Tabs items={choices} selected={selected ?? ''} onSelect={onSelect} entryFocus={false} />
      ) : null}
      <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.page, paddingTop: tabs ? space.md : 0}}>
        {!tabs && choices.length > 1 ? (
          <Button variant="secondary" size={isTV ? 'md' : 'sm'} label={heading} trailingIcon="chevronDown" accessibilityLabel={`${i18n.t('title.seasons')}, ${heading}`} onPress={() => setPicking(true)} />
        ) : !tabs ? (
          <Text variant="heading" lines={1} style={{flexShrink: 1}}>{heading}</Text>
        ) : null}
        {jumpSeasons || jumpEpisodes ? <Button variant="secondary" size={isTV ? 'md' : 'sm'} icon="search" label={i18n.t('title.jumpTo')} onPress={() => setJumping(true)} /> : null}
        {isTV ? null : <View style={{flex: 1}} />}
        {progress ? <Text variant="caption" tone="secondary" lines={1}>{progress}</Text> : null}
        {seasonActions.length ? <Button variant="ghost" round size={isTV ? 'md' : 'sm'} icon="more" accessibilityLabel={i18n.t('title.seasonOptions', {season: heading})} focusKey="action:season-options" onPress={() => setOptions(true)} /> : null}
      </View>
      <Menu open={picking} onClose={() => setPicking(false)} title={i18n.t('title.seasons')} items={choices.map(c => ({id: c.id, label: c.label, selected: c.id === selected}))} onSelect={onSelect} />
      <Menu open={options} onClose={() => setOptions(false)} title={heading} items={seasonActions} onSelect={onSeasonAction} />
      <JumpSheet
        open={jumping}
        onClose={() => setJumping(false)}
        seasons={jumpSeasons ? numbered : undefined}
        episodeTotal={jumpEpisodes ? episodeTotal : undefined}
        onSeason={number => { const hit = numbered.find(c => c.number === number); if (hit) onSelect(hit.id); }}
        onEpisode={onJumpToEpisode}
      />
    </Row>
  );
}

/** "Jump to": a season number (very long shows) and/or an episode number (very long seasons). */
function JumpSheet({open, onClose, seasons, episodeTotal, onSeason, onEpisode}: {open: boolean; onClose: () => void; seasons?: readonly SeasonChoice[]; episodeTotal?: number; onSeason: (number: number) => void; onEpisode: (position: number) => void}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const [season, setSeason] = useState('');
  const [episode, setEpisode] = useState('');
  const numbers = seasons?.map(s => s.number!) ?? [];
  const min = numbers.length ? Math.min(...numbers) : 1;
  const max = numbers.length ? Math.max(...numbers) : 1;
  const seasonValue = Number.parseInt(season, 10);
  const episodeValue = Number.parseInt(episode, 10);
  const seasonOk = !!seasons && numbers.includes(seasonValue);
  const episodeOk = !!episodeTotal && episodeValue >= 1 && episodeValue <= episodeTotal;
  const go = () => {
    if (seasonOk) onSeason(seasonValue);
    else if (episodeOk) onEpisode(episodeValue - 1);
    setSeason('');
    setEpisode('');
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={i18n.t('title.jumpTo')} kind="form" primary={{label: i18n.t('title.go'), disabled: !seasonOk && !episodeOk, onPress: go}}>
      <View style={{gap: space.md, paddingHorizontal: space.md}}>
        {seasons ? <Field label={i18n.t('title.jumpToSeason')} hint={i18n.t('title.jumpToHint', {min, max})} keyboardType="number-pad" value={season} onChangeText={v => { setSeason(v.replace(/\D/g, '')); setEpisode(''); }} returnKeyType="go" onSubmitEditing={() => seasonOk && go()} /> : null}
        {episodeTotal ? <Field label={i18n.t('title.jumpToEpisode')} hint={i18n.t('title.jumpToHint', {min: 1, max: episodeTotal})} keyboardType="number-pad" value={episode} onChangeText={v => { setEpisode(v.replace(/\D/g, '')); setSeason(''); }} returnKeyType="go" onSubmitEditing={() => episodeOk && go()} /> : null}
      </View>
    </Sheet>
  );
}
