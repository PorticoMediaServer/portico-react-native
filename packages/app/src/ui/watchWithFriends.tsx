import React from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {PorticoClient, WatchWithFriendsGroup} from '@porticomediaserver/client-core';
import {PorticoIcon} from '@portico-react-native/icons';
import type {PrototypePlatform} from '../ui-compat/contract';
import {color, font, mobileType, radius, tvType} from './tokens';
import {
  ControlButton,
  Focusable,
  IconButton,
  TVModalFocusTrap,
  useTVModalFocusRestoration,
} from './primitives';
import {useModalAnimationType} from './useReducedMotion';
import {productErrorBody, productText, productTitle} from './productCopy';

export function WatchWithFriendsSheet({
  client,
  mediaId,
  mediaTitle,
  onClose,
  onOpenGroup,
  platform,
  visible,
}: {
  client: PorticoClient;
  mediaId: string;
  mediaTitle: string;
  onClose(): void;
  onOpenGroup(group: WatchWithFriendsGroup): void;
  platform: PrototypePlatform;
  visible: boolean;
}) {
  const television = platform === 'tv';
  const animationType = useModalAnimationType();
  const modalFocus = useTVModalFocusRestoration(television && visible);
  const [groups, setGroups] = React.useState<WatchWithFriendsGroup[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const load = React.useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await client.watchWithFriendsGroups();
      setGroups(response.items.filter(group => group.state !== 'stopped'));
    } catch (cause) {
      setError(
        productErrorBody(cause, 'watch-with-friends.profile-unavailable'),
      );
    } finally {
      setLoading(false);
    }
  }, [client, visible]);
  React.useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusyId('create');
    setError(undefined);
    try {
      const group = await client.createWatchWithFriendsGroup({
        mediaId,
        name: productText('watch-with-friends.group-name', {title: mediaTitle}),
      });
      modalFocus.abandon();
      onOpenGroup(group);
    } catch (cause) {
      setError(productErrorBody(cause, 'watch-with-friends.create-failed'));
    } finally {
      setBusyId(undefined);
    }
  };
  const join = async (group: WatchWithFriendsGroup) => {
    setBusyId(group.id);
    setError(undefined);
    try {
      const joined = await client.joinWatchWithFriendsGroup(group.id);
      modalFocus.abandon();
      onOpenGroup(joined);
    } catch (cause) {
      setError(productErrorBody(cause, 'watch-with-friends.join-failed'));
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <Modal
      animationType={animationType}
      onDismiss={modalFocus.onDismiss}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <TVModalFocusTrap
          platform={platform}
          style={[styles.sheet, television && styles.sheetTv]}
        >
          <View style={styles.header}>
            <View style={styles.titleGroup}>
              <PorticoIcon color={color.screenBlueStrong} id="account.watch-together" size={television ? 30 : 22} />
              <View>
                <Text style={television ? styles.titleTv : styles.titleMobile}>
                  {productText('watch-with-friends.title')}
                </Text>
                <Text
                  style={television ? styles.subtitleTv : styles.subtitleMobile}
                >
                  {productText('watch-with-friends.description')}
                </Text>
              </View>
            </View>
            <IconButton
              icon="action.close"
              label={productText('action.close')}
              onPress={onClose}
              platform={platform}
            />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <ControlButton
            disabled={Boolean(busyId)}
            icon="account.watch-together"
            label={
              busyId === 'create'
                ? productText('watch-with-friends.creating')
                : productText('action.start-watch-group')
            }
            onPress={() => void create()}
            platform={platform}
            primary
          />
          <Text style={television ? styles.sectionTv : styles.sectionMobile}>
            {productText('watch-with-friends.active-groups')}
          </Text>
          {loading ? (
            <ActivityIndicator color={color.screenBlueStrong} />
          ) : groups.length ? (
            <ScrollView contentContainerStyle={styles.list}>
              {groups.map(group => (
                <Focusable
                  accessibilityLabel={productText(
                    'watch-with-friends.join-label',
                    {groupName: group.name},
                  )}
                  disabled={Boolean(busyId)}
                  key={group.id}
                  onPress={() => void join(group)}
                  platform={platform}
                  style={styles.row}
                  focusedStyle={styles.rowFocused}
                  pressedStyle={styles.rowFocused}
                >
                  <View style={styles.rowCopy}>
                    <Text
                      style={
                        television ? styles.rowTitleTv : styles.rowTitleMobile
                      }
                    >
                      {group.name}
                    </Text>
                    <Text
                      style={
                        television ? styles.rowMetaTv : styles.rowMetaMobile
                      }
                    >
                      {productText('watch-with-friends.member-summary', {
                        title: group.mediaTitle,
                        count: group.members.length,
                        people: productText(
                          group.members.length === 1
                            ? 'watch-with-friends.person-one'
                            : 'watch-with-friends.person-many',
                        ),
                        host: group.ownerName,
                      })}
                    </Text>
                  </View>
                  <Text style={styles.joinLabel}>
                    {busyId === group.id
                      ? productText('watch-with-friends.joining')
                      : productText('action.join-group')}
                  </Text>
                </Focusable>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.empty}>
              <Text style={television ? styles.emptyTv : styles.emptyMobile}>
                {productTitle('watch-with-friends.no-active-groups')}
              </Text>
            </View>
          )}
        </TVModalFocusTrap>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: color.slate,
    borderColor: color.line,
    borderRadius: radius.overlay,
    borderWidth: 1,
    gap: 18,
    maxHeight: '82%',
    padding: 22,
    width: '100%',
  },
  sheetTv: {gap: 26, maxWidth: 980, padding: 38},
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 12,
  },
  titleMobile: {
    ...mobileType.title,
    color: color.silver,
    fontFamily: font.demi,
  },
  titleTv: {...tvType.title, color: color.silver, fontFamily: font.demi},
  subtitleMobile: {...mobileType.caption, color: color.dimSilver, marginTop: 3},
  subtitleTv: {...tvType.caption, color: color.dimSilver, marginTop: 5},
  sectionMobile: {
    ...mobileType.section,
    color: color.silver,
    fontFamily: font.demi,
  },
  sectionTv: {...tvType.section, color: color.silver, fontFamily: font.demi},
  error: {...mobileType.body, color: color.record},
  list: {gap: 10},
  row: {
    alignItems: 'center',
    backgroundColor: color.raisedSlate,
    borderColor: color.line,
    borderRadius: radius.control,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
    padding: 16,
  },
  rowFocused: {
    borderColor: color.screenBlueStrong,
    transform: [{scale: 1.015}],
  },
  rowCopy: {flex: 1},
  rowTitleMobile: {
    ...mobileType.body,
    color: color.silver,
    fontFamily: font.demi,
  },
  rowTitleTv: {...tvType.body, color: color.silver, fontFamily: font.demi},
  rowMetaMobile: {...mobileType.caption, color: color.dimSilver, marginTop: 3},
  rowMetaTv: {...tvType.caption, color: color.dimSilver, marginTop: 4},
  joinLabel: {
    ...mobileType.body,
    color: color.screenBlueStrong,
    fontFamily: font.demi,
  },
  empty: {
    borderColor: color.line,
    borderRadius: radius.control,
    borderStyle: 'dashed',
    borderWidth: 1,
    padding: 22,
  },
  emptyMobile: {...mobileType.body, color: color.dimSilver},
  emptyTv: {...tvType.body, color: color.dimSilver},
});
