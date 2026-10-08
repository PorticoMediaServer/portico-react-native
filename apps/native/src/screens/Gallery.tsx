import React, {useState} from 'react';
import {View} from 'react-native';
import {Atmosphere, Backdrop, Badge, Button, Card, Divider, Field, Grid, Icon, ListRow, Menu, Notice, Page, PageHeader, PersonCard, ProgressBar, Section, Segmented, Sheet, Shelf, Skeleton, StateView, Surface, Tabs, Text, iconNames, useTheme} from '../ui';

const sample = [
  {id: '1', title: 'The Shawshank Redemption', subtitle: '1994', progress: 0.42}, // lint-strings-allow: developer-only QA screen
  {id: '2', title: 'Whiplash', subtitle: '2014'}, // lint-strings-allow: developer-only QA screen
  {id: '3', title: 'Your Name.', subtitle: '2016'}, // lint-strings-allow: developer-only QA screen
  {id: '4', title: 'The Lord of the Rings: The Fellowship of the Ring', subtitle: '2001'}, // lint-strings-allow: developer-only QA screen
  {id: '5', title: 'Spirited Away', subtitle: '2001', progress: 0.9}, // lint-strings-allow: developer-only QA screen
  {id: '6', title: 'Howl’s Moving Castle', subtitle: '2004'}, // lint-strings-allow: developer-only QA screen
  {id: '7', title: 'The Godfather', subtitle: '1972'}, // lint-strings-allow: developer-only QA screen
  {id: '8', title: 'Breaking Bad', subtitle: '2008'}, // lint-strings-allow: developer-only QA screen
];

/**
 * Hidden QA screen that renders every primitive in every state. Not linked
 * from product navigation; used for simulator review of the design system.
 * Deliberate i18n exception (M12): sample copy here never ships to users, so
 * its lines carry `lint-strings-allow` instead of catalogue keys.
 */
export function Gallery() {
  const {space, metrics, colors, isTV} = useTheme();
  const [tab, setTab] = useState('discover');
  const [seg, setSeg] = useState('grid');
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const [value, setValue] = useState('');
  return (
    <View style={{flex: 1}}>
      <Atmosphere />
      <Backdrop height={isTV ? 520 : 300} opacity={0.5} />
      <Page>
        <PageHeader eyebrow="Design system" title="Gallery" subtitle="Every primitive, every state" actions={<><Button variant="ghost" round icon="search" accessibilityLabel="Search" /><Button variant="ghost" round icon="account" accessibilityLabel="Account" /></>} /> {/* lint-strings-allow: developer-only QA screen */}
        <Tabs items={[{id: 'discover', label: 'Discover'}, {id: 'browse', label: 'Movies'}, {id: 'collections', label: 'Collections'}, {id: 'categories', label: 'Categories'}]} selected={tab} onSelect={setTab} style={{marginBottom: space.xl}} /> {/* lint-strings-allow: developer-only QA screen */}

        <Section title="Type scale"> {/* lint-strings-allow: developer-only QA screen */}
          <Text variant="display">Display · Your Name.</Text> {/* lint-strings-allow: developer-only QA screen */}
          <Text variant="title">Title · Stranger Things</Text> {/* lint-strings-allow: developer-only QA screen */}
          <Text variant="heading">Heading · Recently Added</Text> {/* lint-strings-allow: developer-only QA screen */}
          <Text variant="subheading">Subheading · Season 1</Text> {/* lint-strings-allow: developer-only QA screen */}
          <Text variant="body">Body · High schoolers Mitsuha and Taki are complete strangers living separate lives. But one night, they suddenly switch places.</Text> {/* lint-strings-allow: developer-only QA screen */}
          <Text variant="caption" tone="secondary">Caption secondary · 2016 · 1h 52m · Animation, Romance</Text> {/* lint-strings-allow: developer-only QA screen */}
          <Text variant="label" tone="tertiary">Label · Portico Demo</Text> {/* lint-strings-allow: developer-only QA screen */}
          <Text variant="micro" tone="tertiary">Micro · Added yesterday</Text> {/* lint-strings-allow: developer-only QA screen */}
        </Section>

        <Section title="Buttons"> {/* lint-strings-allow: developer-only QA screen */}
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
            <Button variant="primary" icon="play" label="Play" hasTVPreferredFocus /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="secondary" icon="bookmark" label="My List" /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="outline" label="Details" /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="ghost" label="See all" trailingIcon="forward" /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="danger" label="Remove" /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="secondary" label="Selected" selected /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="secondary" label="Disabled" disabled /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="primary" label="Loading" loading /> {/* lint-strings-allow: developer-only QA screen */}
          </View>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
            <Button variant="primary" round icon="play" accessibilityLabel="Play" size="lg" /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="secondary" round icon="heart" accessibilityLabel="Favorite" /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="outline" round icon="more" accessibilityLabel="More" /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="ghost" round icon="close" accessibilityLabel="Close" /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="secondary" size="sm" icon="filter" label="Filters" /> {/* lint-strings-allow: developer-only QA screen */}
            <Button variant="secondary" size="sm" label="Sort" trailingIcon="chevronDown" /> {/* lint-strings-allow: developer-only QA screen */}
          </View>
          <Segmented items={[{id: 'grid', label: 'Grid'}, {id: 'list', label: 'List'}, {id: 'compact', label: 'Compact'}]} selected={seg} onSelect={setSeg} /> {/* lint-strings-allow: developer-only QA screen */}
        </Section>

        <Shelf title="Poster shelf" subtitle="Demo Movies" data={sample} itemWidth={metrics.posterWidth} keyExtractor={i => i.id} onSeeAll={() => {}} renderItem={({item}) => <Card title={item.title} subtitle={item.subtitle} progress={item.progress} />} /> {/* lint-strings-allow: developer-only QA screen */}
        <Shelf title="Landscape shelf" data={sample.slice(0, 5)} itemWidth={metrics.landscapeWidth} keyExtractor={i => i.id} renderItem={({item}) => <Card shape="landscape" title={item.title} subtitle="S1 · E3 · 48m" progress={item.progress} />} /> {/* lint-strings-allow: developer-only QA screen */}
        <Shelf title="Square shelf" data={sample.slice(0, 6)} itemWidth={metrics.squareWidth} keyExtractor={i => i.id} renderItem={({item}) => <Card shape="square" icon="music" title={item.title} subtitle="Album · 2014" />} /> {/* lint-strings-allow: developer-only QA screen */}
        <Shelf title="People" data={sample.slice(0, 6)} itemWidth={isTV ? 158 : 92} keyExtractor={i => i.id} renderItem={({item}) => <PersonCard name={item.title.split(':')[0]} subtitle="Acting" />} /> {/* lint-strings-allow: developer-only QA screen */}

        <Section title="Grid"> {/* lint-strings-allow: developer-only QA screen */}
          <Grid data={sample} itemWidth={metrics.posterWidth} gutter={false} keyExtractor={i => i.id} renderItem={(item, w) => <Card title={item.title} subtitle={item.subtitle} width={w} progress={item.progress} />} scrollEnabled={false} />
        </Section>

        <Section title="List rows"> {/* lint-strings-allow: developer-only QA screen */}
          <Surface padded={false}>
            <ListRow ordinal={1} title="Chapter One: The Vanishing of Will Byers" subtitle="Episode 1 · 48m" meta="48m" source={undefined} shape="landscape" progress={0.3} /> {/* lint-strings-allow: developer-only QA screen */}
            <Divider inset={space.md} />
            <ListRow ordinal={2} title="Chapter Two: The Weirdo on Maple Street" subtitle="Episode 2" watched source={undefined} shape="landscape" /> {/* lint-strings-allow: developer-only QA screen */}
            <Divider inset={space.md} />
            <ListRow icon="subtitles" title="Subtitles" subtitle="English (SDH)" trailingIcon="forward" /> {/* lint-strings-allow: developer-only QA screen */}
            <Divider inset={space.md} />
            <ListRow icon="audio" title="Audio" subtitle="English · AAC 5.1" selected /> {/* lint-strings-allow: developer-only QA screen */}
          </Surface>
        </Section>

        <Section title="Fields & feedback"> {/* lint-strings-allow: developer-only QA screen */}
          <Field label="Server address" placeholder="https://" value={value} onChangeText={setValue} hint="Your server’s address, including the port." /> {/* lint-strings-allow: developer-only QA screen */}
          <Field label="Password" placeholder="Password" secure error="That password didn’t match." /> {/* lint-strings-allow: developer-only QA screen */}
          <Notice tone="info" message="Signed in as Justin on Portico Demo." /> {/* lint-strings-allow: developer-only QA screen */}
          <Notice tone="warning" title="Server unreachable" message="Portico Demo hasn’t responded in a while." action="Try again" onAction={() => {}} /> {/* lint-strings-allow: developer-only QA screen */}
          <Notice tone="error" message="Playback failed: the source file is missing." /> {/* lint-strings-allow: developer-only QA screen */}
          <View style={{flexDirection: 'row', gap: space.sm}}>
            <Badge label="4K" /><Badge label="Live" tone="record" /><Badge label="New" tone="accent" /><Badge label="Recording" tone="amber" /> {/* lint-strings-allow: developer-only QA screen */}
          </View>
          <ProgressBar value={0.62} />
          <View style={{flexDirection: 'row', gap: space.sm}}>
            <Skeleton width={metrics.posterWidth} height={metrics.posterWidth * 1.5} />
            <Skeleton width={metrics.posterWidth} height={metrics.posterWidth * 1.5} />
            <View style={{flex: 1, gap: space.sm}}><Skeleton height={20} /><Skeleton height={14} width="60%" /></View>
          </View>
        </Section>

        <Section title="Overlays"> {/* lint-strings-allow: developer-only QA screen */}
          <View style={{flexDirection: 'row', gap: space.sm}}>
            <Button label="Open sheet" onPress={() => setSheet(true)} /> {/* lint-strings-allow: developer-only QA screen */}
            <Button label="Open menu" icon="more" onPress={() => setMenu(true)} /> {/* lint-strings-allow: developer-only QA screen */}
          </View>
        </Section>

        <Section title="Empty state"> {/* lint-strings-allow: developer-only QA screen */}
          <Surface><StateView icon="saved" title="Nothing saved yet" message="Titles you add to your watchlist or favorites show up here." action="Browse libraries" onAction={() => {}} /></Surface> {/* lint-strings-allow: developer-only QA screen */}
        </Section>

        <Section title="Icons"> {/* lint-strings-allow: developer-only QA screen */}
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.md}}>
            {iconNames.map(n => (
              <View key={n} style={{width: metrics.hit, height: metrics.hit, alignItems: 'center', justifyContent: 'center', borderRadius: metrics.radius.small, backgroundColor: colors.raised}}>
                <Icon name={n} />
              </View>
            ))}
          </View>
        </Section>
      </Page>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Playback options" subtitle="Your Name." footer={<><Button variant="ghost" label="Cancel" onPress={() => setSheet(false)} /><Button variant="primary" label="Done" onPress={() => setSheet(false)} /></>}> {/* lint-strings-allow: developer-only QA screen */}
        <ListRow icon="quality" title="Quality" subtitle="Auto (Original)" trailingIcon="forward" /> {/* lint-strings-allow: developer-only QA screen */}
        <ListRow icon="audio" title="Audio" subtitle="English · AAC" trailingIcon="forward" /> {/* lint-strings-allow: developer-only QA screen */}
        <ListRow icon="subtitles" title="Subtitles" subtitle="Off" trailingIcon="forward" /> {/* lint-strings-allow: developer-only QA screen */}
        <ListRow icon="speed" title="Speed" subtitle="1×" trailingIcon="forward" /> {/* lint-strings-allow: developer-only QA screen */}
        <ListRow icon="sleep" title="Sleep timer" subtitle="Off" trailingIcon="forward" /> {/* lint-strings-allow: developer-only QA screen */}
      </Sheet>
      <Menu open={menu} onClose={() => setMenu(false)} title="Your Name." /* lint-strings-allow: developer-only QA screen */ onSelect={() => {}} items={[
        {id: 'watchlist', label: 'Add to watchlist', icon: 'bookmark'}, /* lint-strings-allow: developer-only QA screen */
        {id: 'fav', label: 'Add to favorites', icon: 'heart'}, /* lint-strings-allow: developer-only QA screen */
        {id: 'watched', label: 'Mark as watched', icon: 'check'}, /* lint-strings-allow: developer-only QA screen */
        {id: 'playlist', label: 'Add to playlist', icon: 'queue', section: 'Organize'}, /* lint-strings-allow: developer-only QA screen */
        {id: 'collection', label: 'Add to collection', icon: 'collection'}, /* lint-strings-allow: developer-only QA screen */
        {id: 'queue', label: 'Play next', icon: 'next', section: 'Queue'}, /* lint-strings-allow: developer-only QA screen */
        {id: 'later', label: 'Add to queue', icon: 'plus'}, /* lint-strings-allow: developer-only QA screen */
      ]} />
    </View>
  );
}
