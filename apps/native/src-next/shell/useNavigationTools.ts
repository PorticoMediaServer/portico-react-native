import {useEffect, useState, useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import type {ActivitySummarySnapshot} from '../../../../packages/client-core/src/admin/activity-summary';
import {nativeShellRoutes} from './route-registry';
import type {NavigationTools} from './navigation-tools';
import type {NativeShellRuntime, NativeShellSnapshot} from './runtime';

const unavailable: ActivitySummarySnapshot = Object.freeze({phase: 'unavailable'});
const noSubscribe = () => () => {};
const noActivity = () => unavailable;
const capabilities = () => `${nativeShellRoutes.get('notifications') ? 1 : 0}${nativeShellRoutes.get('server-dashboard') ? 1 : 0}`;
const counter = (value: number | undefined) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** No destination exists until its actual screen owner registers it. */
export function useNavigationTools(runtime: NativeShellRuntime, snapshot: NativeShellSnapshot, current: () => boolean, enabled: boolean): NavigationTools {
  const routes = useSyncExternalStore(nativeShellRoutes.subscribe, capabilities);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {const subscription = AppState.addEventListener('change', value => setForeground(value === 'active')); return () => subscription.remove();}, []);
  const binding = runtime.navigationActivity;
  const activity = useSyncExternalStore(binding?.service.subscribe ?? noSubscribe, binding?.service.getSnapshot ?? noActivity);
  const notificationAction = snapshot.account.actions.find(action => action.id === 'notifications');
  const serverAction = snapshot.account.serverAction;
  const notificationsAvailable = routes.startsWith('1') && !!notificationAction;
  const activityAvailable = routes.endsWith('1') && snapshot.account.viewerRole === 'owner' && !!serverAction;
  const active = enabled && foreground && activityAvailable;
  useEffect(() => {
    if (!binding) return;
    binding.service.setActive(active);
    if (active && current()) {binding.service.attach(binding.events); binding.service.load();}
    return () => binding.service.setActive(false);
  }, [active, binding, current]);
  return {
    ...(notificationsAvailable ? {notifications: {count: counter(snapshot.unreadNotificationCount), onPress: () => {
      if (current() && nativeShellRoutes.get('notifications')) notificationAction.onPress();
    }}} : {}),
    ...(activityAvailable ? {activity: {count: active && activity.phase === 'ready' ? counter(activity.document?.streams.count) : undefined, onPress: () => {
      if (current() && nativeShellRoutes.get('server-dashboard')) serverAction.onPress();
    }}} : {}),
  };
}
