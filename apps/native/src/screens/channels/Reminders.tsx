import {useEffect} from 'react';
import {useDueReminder} from '../../app/channels';
import {useI18n} from '../../app/i18n';
import {showToast} from '../../ui';

/**
 * "Remind me" (Spec §3.5, decision 3): in-app only. While Portico is open, a toast 2 minutes before
 * a reminded program starts, with Watch (which opens Channels). No system notifications of any kind.
 * Mount once in the shell; it draws nothing itself.
 */
export function ChannelReminderHost({onOpenChannels}: {onOpenChannels: () => void}) {
  const {due, dismiss} = useDueReminder();
  const i18n = useI18n();
  useEffect(() => {
    if (!due) return;
    showToast({message: i18n.t('guide.reminder', {title: due.title, channel: due.channelName}), icon: 'bell', action: {label: i18n.t('channels.watch'), onPress: onOpenChannels}});
    dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due]);
  return null;
}
