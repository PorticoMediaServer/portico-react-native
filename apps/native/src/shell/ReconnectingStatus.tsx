import React from 'react';
import {View} from 'react-native';
import {useConnectionActions, useConnectionStatus} from '../app/connection-context';
import {useI18n} from '../app/i18n';
import {useSession} from '../app/session';
import {StateView} from '../ui';

/**
 * MU1: the shell's failure mode for a server it can't use (web parity). While the connection
 * status shows, this centered status with the spinner replaces the page's content (the screen's
 * own content unmounts, so no card shows its own error). The shell stays usable: the rail or tab
 * bar, Settings, Account, switching server and Downloads are untouched, and the page comes back
 * by itself, reloading its data, when the route is ready again.
 *
 * Catalogue copy only. On TV the primary button takes focus through the guarded screen's focus
 * guide (`autoFocus`); this is not a modal, sheet or cover, so the rail stays reachable.
 */
export function ReconnectingStatus() {
  const i18n = useI18n();
  const status = useConnectionStatus();
  const {retry, useAnother} = useConnectionActions();
  const session = useSession();
  const host = session.saved?.host ?? '';
  // `shown` always carries a reason (the store sets both together); fall back to the lost copy.
  const reason = status.reason ?? 'lost';
  const title =
    reason === 'checking'
      ? i18n.t('launch.connectingTo', {host})
      : reason === 'unreachable'
        ? i18n.t('savedServer.title', {host})
        : i18n.t('launch.reconnectingTitle');
  const message =
    reason === 'checking'
      ? undefined
      : reason === 'unreachable'
        ? i18n.t('error.unreachable')
        : i18n.t('launch.reconnectingBody');
  return (
    <View style={{flex: 1, justifyContent: 'center'}}>
      <StateView
        loading
        title={title}
        message={message}
        action={reason === 'checking' ? undefined : i18n.t('action.tryAgain')}
        onAction={reason === 'checking' ? undefined : retry}
        secondaryAction={i18n.t('action.useAnotherServerOrAccount')}
        onSecondaryAction={useAnother}
      />
    </View>
  );
}
