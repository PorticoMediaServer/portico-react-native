import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {PorticoIcon} from '@portico-react-native/icons';
import {
  porticoDestinationIsAvailable,
  productMessage,
  type PorticoClient,
  type PorticoDestination,
  type ProductMessageId,
  type ViewerFeedbackCategory,
  type ViewerFeedbackKind,
  type ViewerNotification,
} from '@portico/client-core';
import {
  dismissRuntimeNotice,
  productErrorMessageId,
  setHostedNotificationBadge,
  subscribeHostedNotificationWakes,
  usePorticoAuth,
  useRuntimeNotices,
  useViewerRuntime,
} from '@portico-react-native/infrastructure';
import type {PrototypePlatform} from '../ui-compat/contract';
import {
  ControlButton,
  EmptyState,
  Focusable,
  IconButton,
  InlineNotice,
  TVModalFocusTrap,
  useTVModalFocusRestoration,
} from './primitives';
import {color, font, mobileType, tvType} from './tokens';
import {usePorticoNavigationActions} from './navigation';
import {
  productBody,
  productText,
  productTitle,
  safeProductCopy,
} from './productCopy';
import {useModalAnimationType} from './useReducedMotion';
import {useMobileChromeMetrics} from './mobileChromeMetrics';
import {
  dispatchPorticoDestination,
  parsePorticoExternalLink,
} from './navigationIntent';

type FeedbackContext = {
  mediaId?: string;
  mediaTitle?: string;
  playbackSessionId?: string;
  initialKind?: ViewerFeedbackKind;
};
type LocalRuntimeNotice = {id: string; title: string; body: string};
type EngagementValue = {
  unreadCount: number;
  openNotifications(): void;
  openFeedback(context?: FeedbackContext): void;
};
const EngagementContext = createContext<EngagementValue>({
  unreadCount: 0,
  openNotifications() {},
  openFeedback() {},
});
export const useEngagement = () => useContext(EngagementContext);

/** Shared canonical notification destination consumed by React Navigation. */
export const parsePorticoLink = parsePorticoExternalLink;

export function porticoLinkIsAvailable(
  target: PorticoDestination | undefined,
  platform: PrototypePlatform,
): boolean {
  return Boolean(
    target &&
    porticoDestinationIsAvailable(
      target,
      platform === 'tv' ? 'television' : 'handheld',
    ),
  );
}

export function PorticoEngagementProvider({
  children,
  platform,
}: {
  children: React.ReactNode;
  platform: PrototypePlatform;
}) {
  const auth = usePorticoAuth();
  const client = auth.session?.client;
  const queryClient = useQueryClient();
  const navigation = usePorticoNavigationActions();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackContext>();
  const runtimeNotices = useRuntimeNotices();
  const notifications = useQuery({
    enabled: Boolean(client),
    queryKey: ['viewer-notifications'],
    queryFn: ({signal}) => client!.viewerNotifications({limit: 100}, {signal}),
    // Push wakes and the application event stream own freshness. A timer here
    // multiplied idle traffic across every signed-in client.
    refetchInterval: false,
    staleTime: 60_000,
  });
  const localNotices = useMemo<LocalRuntimeNotice[]>(
    () =>
      runtimeNotices.map(item => {
        const message = productMessage(item.messageId);
        return {
          id: item.id,
          title: safeProductCopy(
            message.title || message.text,
            productText('notification.fallback-title'),
          ),
          body: safeProductCopy(
            message.body || message.text,
            productText('notification.fallback-title'),
          ),
        };
      }),
    [runtimeNotices],
  );
  const openTarget = useCallback(
    (target: PorticoDestination | undefined) => {
      if (!porticoLinkIsAvailable(target, platform)) return;
      if (!target) return;
      dispatchPorticoDestination(navigation, target, {
        openNotifications: () => setNotificationsOpen(true),
      });
    },
    [navigation, platform],
  );
  useEffect(
    () =>
      subscribeHostedNotificationWakes(() => {
        void queryClient.invalidateQueries({
          queryKey: ['viewer-notifications'],
        });
      }),
    [queryClient],
  );
  useEffect(() => {
    if (platform !== 'tv')
      void setHostedNotificationBadge(
        (notifications.data?.unreadCount ?? 0) + localNotices.length,
      ).catch(() => undefined);
  }, [localNotices.length, notifications.data?.unreadCount, platform]);
  const important =
    platform === 'tv'
      ? notifications.data?.items.find(
          item =>
            !item.readAt &&
            (item.severity === 'warning' || item.severity === 'error'),
        )
      : undefined;
  const value = useMemo<EngagementValue>(
    () => ({
      unreadCount: (notifications.data?.unreadCount ?? 0) + localNotices.length,
      openNotifications: () => setNotificationsOpen(true),
      openFeedback: context => setFeedback(context ?? {initialKind: 'general'}),
    }),
    [localNotices.length, notifications.data?.unreadCount],
  );
  return (
    <EngagementContext.Provider value={value}>
      {children}
      {important && client ? (
        <TVImportantNotice
          client={client}
          notification={important}
          onChanged={() =>
            void queryClient.invalidateQueries({
              queryKey: ['viewer-notifications'],
            })
          }
        />
      ) : null}
      {platform !== 'tv' ? (
        <NotificationSheet
          client={client}
          localNotices={localNotices}
          onClose={() => setNotificationsOpen(false)}
          onDismissLocal={dismissRuntimeNotice}
          onNavigate={openTarget}
          page={notifications.data}
          query={notifications}
          visible={notificationsOpen}
        />
      ) : null}
      {client ? (
        <FeedbackSheet
          client={client}
          context={feedback}
          onClose={() => setFeedback(undefined)}
          platform={platform}
        />
      ) : null}
    </EngagementContext.Provider>
  );
}

function notificationCopy(item: ViewerNotification) {
  const message = productMessage(item.messageId, item.interpolation);
  return {
    title: safeProductCopy(
      item.content?.title || message.title || message.text,
      productText('notification.fallback-title'),
    ),
    body: safeProductCopy(
      message.body || message.text,
      productText('notification.fallback-title'),
    ),
  };
}

function NotificationSheet({
  client,
  localNotices,
  onClose,
  onDismissLocal,
  onNavigate,
  page,
  query,
  visible,
}: {
  client?: PorticoClient;
  localNotices: LocalRuntimeNotice[];
  onClose(): void;
  onDismissLocal(id: string): void;
  onNavigate(target: PorticoDestination): void;
  page?: Awaited<ReturnType<PorticoClient['viewerNotifications']>>;
  query: ReturnType<typeof useQuery>;
  visible: boolean;
}) {
  const animationType = useModalAnimationType();
  const {primaryHeaderBottom} = useMobileChromeMetrics();
  const [error, setError] = useState<string>();
  const [additional, setAdditional] = useState<ViewerNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    setAdditional([]);
    setNextCursor(page?.pageInfo.nextCursor ?? null);
  }, [page?.pageInfo.nextCursor, page?.revision]);
  const update = async (
    item: ViewerNotification,
    action: 'mark-read' | 'mark-unread' | 'archive',
  ) => {
    if (!client || !page) return;
    setError(undefined);
    try {
      await client.updateViewerNotificationReceipts({
        version: 'v1',
        recipient: page.recipient,
        notificationIds: [item.id],
        action,
        expectedRevision: page.revision,
      });
      await query.refetch();
    } catch (cause) {
      setError(productErrorMessageId(cause, 'notification.receipt-failed'));
    }
  };
  const navigate = (item: ViewerNotification) => {
    const action = item.actions.find(
      candidate => candidate.kind === 'navigate',
    );
    if (!action) return;
    const mediaId = action.parameters.mediaId;
    const route: PorticoDestination | undefined =
      action.target === 'media.detail' && mediaId
        ? {destination: 'media-detail', mediaId}
        : action.target === 'downloads'
          ? {destination: 'downloads'}
          : action.target === 'dvr.conflicts'
            ? {destination: 'channels'}
            : action.target === 'account.security'
              ? {destination: 'settings', section: 'security'}
              : undefined;
    if (route) {
      onClose();
      onNavigate(route);
    }
  };
  const loadMore = async () => {
    if (!client || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(undefined);
    try {
      const next = await client.viewerNotifications({
        cursor: nextCursor,
        limit: 100,
      });
      setAdditional(current => [
        ...current,
        ...next.items.filter(
          item =>
            !current.some(known => known.id === item.id) &&
            !page?.items.some(known => known.id === item.id),
        ),
      ]);
      setNextCursor(next.pageInfo.nextCursor);
    } catch (cause) {
      setError(productErrorMessageId(cause, 'notification.load-failed'));
    } finally {
      setLoadingMore(false);
    }
  };
  return (
    <Modal
      animationType={animationType}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.layer}>
        <Pressable
          accessible={false}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            styles.notificationPopover,
            {top: primaryHeaderBottom},
          ]}
        >
          <View style={styles.header}>
            <Text style={[mobileType.title, styles.sheetTitle]}>
              {productText('notification.title')}
            </Text>
            <IconButton
              icon="action.close"
              label={productText('action.close')}
              onPress={onClose}
              platform="mobile"
            />
          </View>
          {client && page?.unreadCount ? (
            <ControlButton
              compact
              label={productText('notification.mark-all-read')}
              onPress={() =>
                void client
                  .markAllViewerNotificationsRead()
                  .then(() => query.refetch())
                  .catch(cause =>
                    setError(
                      productErrorMessageId(
                        cause,
                        'notification.receipt-failed',
                      ),
                    ),
                  )
              }
              platform="mobile"
            />
          ) : null}
          {error ? (
            <InlineNotice kind="error" message={error} platform="mobile" />
          ) : null}
          {localNotices.map(item => (
            <View key={item.id} style={[styles.notice, styles.noticeUnread]}>
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>{item.title}</Text>
                <Text style={styles.noticeBody}>{item.body}</Text>
              </View>
              <View style={styles.noticeActions}>
                <IconButton
                  icon="action.dismiss"
                  label={productText('action.dismiss')}
                  onPress={() => onDismissLocal(item.id)}
                  platform="mobile"
                />
              </View>
            </View>
          ))}
          {query.isLoading ? (
            <ActivityIndicator color={color.screenBlue} />
          ) : query.error ? (
            <EmptyState
              actionLabel={productText('action.retry')}
              message={productBody('notification.load-failed')}
              onAction={() => void query.refetch()}
              platform="mobile"
              title={productTitle('notification.load-failed')}
            />
          ) : !page?.items.length && !localNotices.length ? (
            <EmptyState
              message={productBody('notification.empty')}
              platform="mobile"
              title={productTitle('notification.empty')}
            />
          ) : page?.items.length || additional.length ? (
            <ScrollView contentContainerStyle={styles.list}>
              {[...(page?.items ?? []), ...additional].map(item => {
                const copy = notificationCopy(item);
                return (
                  <View
                    key={item.id}
                    style={[styles.notice, !item.readAt && styles.noticeUnread]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        void update(item, 'mark-read');
                        navigate(item);
                      }}
                      style={styles.noticeCopy}
                    >
                      <Text style={styles.noticeTitle}>{copy.title}</Text>
                      <Text style={styles.noticeBody}>{copy.body}</Text>
                      <Text style={styles.noticeTime}>
                        {new Date(item.createdAt).toLocaleString()}
                      </Text>
                    </Pressable>
                    <View style={styles.noticeActions}>
                      <IconButton
                        icon={
                          item.readAt
                            ? 'action.mark-unread'
                            : 'action.mark-read'
                        }
                        label={productText(
                          item.readAt
                            ? 'action.mark-unread'
                            : 'action.mark-read',
                        )}
                        onPress={() =>
                          void update(
                            item,
                            item.readAt ? 'mark-unread' : 'mark-read',
                          )
                        }
                        platform="mobile"
                      />
                      <IconButton
                        icon="action.archive"
                        label={productText('action.archive')}
                        onPress={() => void update(item, 'archive')}
                        platform="mobile"
                      />
                    </View>
                  </View>
                );
              })}
              {nextCursor ? (
                <ControlButton
                  disabled={loadingMore}
                  label={
                    loadingMore
                      ? productText('state.loading-more')
                      : productText('action.load-more')
                  }
                  onPress={() => void loadMore()}
                  platform="mobile"
                />
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function TVImportantNotice({
  client,
  notification,
  onChanged,
}: {
  client: PorticoClient;
  notification: ViewerNotification;
  onChanged(): void;
}) {
  const copy = notificationCopy(notification);
  return (
    <View accessibilityLiveRegion="polite" style={styles.tvNotice}>
      <PorticoIcon color={color.silver} id="communication.report" size={26} />
      <View style={styles.tvNoticeCopy}>
        <Text style={styles.tvNoticeTitle}>{copy.title}</Text>
        <Text numberOfLines={2} style={styles.tvNoticeBody}>
          {copy.body}
        </Text>
      </View>
      <ControlButton
        compact
        label={productText('action.dismiss')}
        onPress={() =>
          void client
            .viewerNotifications({limit: 1})
            .then(page =>
              client.updateViewerNotificationReceipts({
                version: 'v1',
                recipient: page.recipient,
                notificationIds: [notification.id],
                action: 'mark-read',
                expectedRevision: page.revision,
              }),
            )
            .then(onChanged)
        }
        platform="tv"
      />
    </View>
  );
}

const feedbackKinds: Array<{id: ViewerFeedbackKind; label: ProductMessageId}> =
  [
    {id: 'general', label: 'feedback.kind.general'},
    {id: 'playback', label: 'feedback.kind.playback'},
    {id: 'media', label: 'feedback.kind.media'},
    {id: 'quality', label: 'feedback.kind.quality'},
  ];
const feedbackCategories: Record<ViewerFeedbackKind, ViewerFeedbackCategory[]> =
  {
    general: ['other'],
    playback: [
      'wont-play',
      'buffering',
      'playback-stopped',
      'wrong-video',
      'wrong-audio',
      'wrong-subtitles',
      'other',
    ],
    media: [
      'incorrect-media-information',
      'wrong-video',
      'wrong-audio',
      'wrong-subtitles',
      'other',
    ],
    quality: ['higher-quality-request', 'other'],
  };
const categoryMessageId = (
  category: ViewerFeedbackCategory,
): ProductMessageId => `feedback.category.${category}` as ProductMessageId;

function FeedbackSheet({
  client,
  context,
  onClose,
  platform,
}: {
  client: PorticoClient;
  context?: FeedbackContext;
  onClose(): void;
  platform: PrototypePlatform;
}) {
  const animationType = useModalAnimationType();
  const modalFocus = useTVModalFocusRestoration(
    platform === 'tv' && Boolean(context),
  );
  const runtime = useViewerRuntime();
  const capabilities = useQuery({
    enabled: Boolean(context),
    queryKey: ['viewer-feedback-capabilities'],
    queryFn: ({signal}) => client.viewerFeedbackCapabilities({signal}),
    staleTime: 60_000,
  });
  const [kind, setKind] = useState<ViewerFeedbackKind>(
    context?.initialKind ?? 'general',
  );
  const [category, setCategory] = useState<ViewerFeedbackCategory>('other');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tvStep, setTVStep] = useState<'kind' | 'category' | 'confirm'>('kind');
  useEffect(() => {
    if (context) {
      const next = context.initialKind ?? 'general';
      setKind(next);
      setCategory(feedbackCategories[next][0]!);
      setMessage('');
      setSent(false);
      setError(undefined);
      setTVStep('kind');
    }
  }, [context]);
  useEffect(() => {
    const allowed = capabilities.data?.allowedKinds;
    if (!allowed?.length || allowed.includes(kind)) return;
    setKind(allowed[0]!);
    setCategory(feedbackCategories[allowed[0]!][0]!);
  }, [capabilities.data?.allowedKinds, kind]);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const available = capabilities.data;
      if (!available?.enabled || !available.allowedKinds.includes(kind))
        throw new Error(productBody('feedback.disabled'));
      await runtime.runRequest(signal =>
        client.submitViewerFeedback(
          {
            version: 'v1',
            kind,
            category,
            message: message.trim().slice(0, available.messageMaxLength),
            context: {
              mediaId: context?.mediaId,
              playbackSessionId: context?.playbackSessionId,
              deviceClass: platform === 'tv' ? 'television' : 'mobile',
              platform: platform === 'tv' ? 'tvos' : 'ios',
              appVersion: '0.1.0',
            },
          },
          {signal},
        ),
      );
      setSent(true);
    } catch (cause) {
      setError(productErrorMessageId(cause, 'feedback.load-failed'));
    } finally {
      setBusy(false);
    }
  };
  if (platform === 'tv') {
    const closeOrBack = () => {
      if (sent || tvStep === 'kind') onClose();
      else setTVStep(tvStep === 'confirm' ? 'category' : 'kind');
    };
    return (
      <Modal
        animationType={animationType}
        onDismiss={modalFocus.onDismiss}
        onRequestClose={closeOrBack}
        presentationStyle="fullScreen"
        visible={Boolean(context)}
      >
        <View style={styles.tvFeedbackCanvas}>
          <TVModalFocusTrap platform="tv" style={styles.tvFeedbackContent}>
            <View style={styles.header}>
              <Text style={[tvType.title, styles.sheetTitle]}>
                {context?.mediaId
                  ? productText('feedback.heading.report-media', {
                      mediaTitle:
                        context.mediaTitle ??
                        productText('feedback.heading.report'),
                    })
                  : productText('feedback.heading.message')}
              </Text>
              <IconButton
                icon="action.close"
                label={productText('feedback.close-label')}
                onPress={onClose}
                platform="tv"
              />
            </View>
            {capabilities.isLoading ? (
              <ActivityIndicator color={color.screenBlue} />
            ) : capabilities.error ? (
              <EmptyState
                actionLabel={productText('action.retry')}
                message={productBody('feedback.load-failed')}
                onAction={() => void capabilities.refetch()}
                platform="tv"
                title={productTitle('feedback.load-failed')}
              />
            ) : capabilities.data?.enabled === false ? (
              <>
                <InlineNotice
                  kind="warning"
                  message={productBody('feedback.disabled')}
                  platform="tv"
                />
                <ControlButton
                  label={productText('action.close')}
                  onPress={onClose}
                  platform="tv"
                />
              </>
            ) : sent ? (
              <>
                <InlineNotice
                  kind="info"
                  message={productBody('feedback.sent')}
                  platform="tv"
                />
                <ControlButton
                  label={productText('action.done')}
                  onPress={onClose}
                  platform="tv"
                  primary
                  requestInitialTVFocus
                />
              </>
            ) : (
              <View style={styles.tvFeedbackSteps}>
                <Text style={styles.tvStepLabel}>
                  {tvStep === 'kind'
                    ? 'What would you like to report?'
                    : tvStep === 'category'
                      ? productText('feedback.what-happened')
                      : 'Review report'}
                </Text>
                {tvStep === 'kind'
                  ? feedbackKinds
                      .filter(option =>
                        capabilities.data?.allowedKinds.includes(option.id),
                      )
                      .map((option, index) => (
                        <Focusable
                          accessibilityRole="radio"
                          accessibilityState={{checked: kind === option.id}}
                          hasTVPreferredFocus={
                            kind === option.id || index === 0
                          }
                          key={option.id}
                          onPress={() => {
                            setKind(option.id);
                            setCategory(feedbackCategories[option.id][0]!);
                            setTVStep('category');
                          }}
                          platform="tv"
                          style={[
                            styles.tvFeedbackChoice,
                            kind === option.id && styles.choiceSelected,
                          ]}
                          focusedStyle={styles.choiceFocused}
                          tvFocusId={`feedback:kind:${option.id}`}
                        >
                          <Text style={styles.tvChoiceText}>
                            {productText(option.label)}
                          </Text>
                        </Focusable>
                      ))
                  : null}
                {tvStep === 'category'
                  ? feedbackCategories[kind].map((value, index) => (
                      <Focusable
                        accessibilityRole="radio"
                        accessibilityState={{checked: category === value}}
                        hasTVPreferredFocus={category === value || index === 0}
                        key={value}
                        onPress={() => {
                          setCategory(value);
                          setTVStep('confirm');
                        }}
                        platform="tv"
                        style={[
                          styles.tvFeedbackChoice,
                          category === value && styles.choiceSelected,
                        ]}
                        focusedStyle={styles.choiceFocused}
                        tvFocusId={`feedback:category:${value}`}
                      >
                        <Text style={styles.tvChoiceText}>
                          {productText(categoryMessageId(value))}
                        </Text>
                      </Focusable>
                    ))
                  : null}
                {tvStep === 'confirm' ? (
                  <View style={styles.tvFeedbackConfirmation}>
                    <Text style={styles.tvChoiceText}>
                      {productText(categoryMessageId(category))}
                    </Text>
                    <Text style={styles.privacy}>
                      {productText('feedback.privacy', {
                        retentionDays: capabilities.data?.retentionDays,
                      })}
                    </Text>
                    {error ? (
                      <InlineNotice
                        kind="error"
                        message={error}
                        platform="tv"
                      />
                    ) : null}
                    <View style={styles.choiceRow}>
                      <ControlButton
                        label={productText('action.back')}
                        onPress={() => setTVStep('category')}
                        platform="tv"
                        requestInitialTVFocus
                      />
                      <ControlButton
                        disabled={busy}
                        icon="action.send"
                        label={
                          busy
                            ? productText('action.sending-message')
                            : productText('action.send-message')
                        }
                        onPress={() => void submit()}
                        platform="tv"
                        primary
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            )}
          </TVModalFocusTrap>
        </View>
      </Modal>
    );
  }
  return (
    <Modal
      animationType={animationType}
      onDismiss={modalFocus.onDismiss}
      onRequestClose={onClose}
      transparent
      visible={Boolean(context)}
    >
      <View style={styles.layer}>
        <Pressable
          accessible={false}
          focusable={false}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <TVModalFocusTrap platform="mobile" style={styles.sheet}>
          <View style={styles.header}>
            <Text style={[mobileType.title, styles.sheetTitle]}>
              {context?.mediaId
                ? productText('feedback.heading.report-media', {
                    mediaTitle:
                      context.mediaTitle ??
                      productText('feedback.heading.report'),
                  })
                : productText('feedback.heading.message')}
            </Text>
            <IconButton
              icon="action.close"
              label={productText('feedback.close-label')}
              onPress={onClose}
              platform="mobile"
            />
          </View>
          {capabilities.isLoading ? (
            <ActivityIndicator color={color.screenBlue} />
          ) : capabilities.error ? (
            <EmptyState
              actionLabel={productText('action.retry')}
              message={productBody('feedback.load-failed')}
              onAction={() => void capabilities.refetch()}
              platform={platform}
              title={productTitle('feedback.load-failed')}
            />
          ) : capabilities.data?.enabled === false ? (
            <>
              <InlineNotice
                kind="warning"
                message={productBody('feedback.disabled')}
                platform={platform}
              />
              <ControlButton
                label={productText('action.close')}
                onPress={onClose}
                platform={platform}
              />
            </>
          ) : sent ? (
            <>
              <InlineNotice
                kind="info"
                message={productBody('feedback.sent')}
                platform={platform}
              />
              <ControlButton
                label={productText('action.done')}
                onPress={onClose}
                platform={platform}
                primary
              />
            </>
          ) : (
            <ScrollView contentContainerStyle={styles.feedbackBody}>
              <View style={styles.choiceRow}>
                {feedbackKinds
                  .filter(option =>
                    capabilities.data?.allowedKinds.includes(option.id),
                  )
                  .map(option => (
                    <Focusable
                      accessibilityRole="radio"
                      accessibilityState={{checked: kind === option.id}}
                      key={option.id}
                      onPress={() => {
                        setKind(option.id);
                        setCategory(feedbackCategories[option.id][0]!);
                      }}
                      platform={platform}
                      style={[
                        styles.choice,
                        kind === option.id && styles.choiceSelected,
                      ]}
                      focusedStyle={styles.choiceFocused}
                    >
                      <Text style={styles.choiceText}>
                        {productText(option.label)}
                      </Text>
                    </Focusable>
                  ))}
              </View>
              <Text style={styles.fieldLabel}>
                {productText('feedback.what-happened')}
              </Text>
              {feedbackCategories[kind].map(value => (
                <Focusable
                  accessibilityRole="radio"
                  accessibilityState={{checked: category === value}}
                  key={value}
                  onPress={() => setCategory(value)}
                  platform={platform}
                  style={[
                    styles.category,
                    category === value && styles.choiceSelected,
                  ]}
                  focusedStyle={styles.choiceFocused}
                >
                  <Text style={styles.choiceText}>
                    {productText(categoryMessageId(value))}
                  </Text>
                </Focusable>
              ))}
              <Text style={styles.fieldLabel}>
                {productText('feedback.message-label')}
              </Text>
              <TextInput
                maxLength={1000}
                multiline
                onChangeText={setMessage}
                placeholder={productText('feedback.message-placeholder')}
                placeholderTextColor={color.mutedSilver}
                style={styles.message}
                value={message}
              />
              <Text style={styles.privacy}>
                {productText('feedback.privacy', {
                  retentionDays: capabilities.data?.retentionDays,
                })}
              </Text>
              {error ? (
                <InlineNotice
                  kind="error"
                  message={error}
                  platform={platform}
                />
              ) : null}
              <ControlButton
                disabled={busy}
                icon="action.send"
                label={
                  busy
                    ? productText('action.sending-message')
                    : productText('action.send-message')
                }
                onPress={() => void submit()}
                platform={platform}
                primary
              />
            </ScrollView>
          )}
        </TVModalFocusTrap>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: 12,
  },
  sheet: {
    backgroundColor: 'rgba(21,31,41,0.94)',
    borderColor: color.lineStrong,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    maxHeight: '90%',
    padding: 18,
    width: '100%',
  },
  sheetTv: {alignSelf: 'center', maxHeight: '84%', padding: 30, width: 900},
  notificationPopover: {
    alignSelf: 'flex-end',
    maxHeight: '72%',
    position: 'absolute',
    right: 12,
    width: '92%',
  },
  sheetTitle: {color: color.silver},
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  list: {gap: 1, paddingBottom: 18},
  notice: {
    alignItems: 'center',
    backgroundColor: color.recess,
    flexDirection: 'row',
    minHeight: 92,
    padding: 12,
  },
  noticeUnread: {borderLeftColor: color.screenBlueStrong, borderLeftWidth: 3},
  noticeCopy: {flex: 1},
  noticeTitle: {color: color.silver, fontFamily: font.demi, fontSize: 15},
  noticeBody: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  noticeTime: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 10,
    marginTop: 5,
  },
  noticeActions: {flexDirection: 'row', gap: 4},
  tvNotice: {
    alignItems: 'center',
    backgroundColor: color.raisedSlate,
    borderColor: color.line,
    borderWidth: 1,
    bottom: 28,
    flexDirection: 'row',
    gap: 14,
    left: 72,
    padding: 16,
    position: 'absolute',
    right: 72,
  },
  tvNoticeCopy: {flex: 1},
  tvNoticeTitle: {color: color.silver, fontFamily: font.demi, fontSize: 21},
  tvNoticeBody: {
    color: color.softSilver,
    fontFamily: font.regular,
    fontSize: 17,
    marginTop: 3,
  },
  feedbackBody: {gap: 10, paddingBottom: 18},
  choiceRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  choice: {
    borderColor: color.line,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  choiceSelected: {
    backgroundColor: color.brightSlate,
    borderColor: color.screenBlue,
  },
  choiceFocused: {borderColor: color.focus, borderWidth: 3},
  choiceText: {color: color.silver, fontFamily: font.demi, fontSize: 14},
  category: {
    borderBottomColor: color.lineSoft,
    borderBottomWidth: 1,
    minHeight: 48,
    padding: 12,
  },
  fieldLabel: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 13,
    marginTop: 6,
  },
  message: {
    backgroundColor: color.recess,
    borderColor: color.line,
    borderWidth: 1,
    color: color.silver,
    fontFamily: font.regular,
    fontSize: 15,
    minHeight: 110,
    padding: 12,
    textAlignVertical: 'top',
  },
  privacy: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  tvFeedbackCanvas: {backgroundColor: color.projector, flex: 1},
  tvFeedbackContent: {flex: 1, gap: 26, paddingHorizontal: 120, paddingTop: 64},
  tvFeedbackSteps: {gap: 10, maxWidth: 1100},
  tvStepLabel: {
    color: color.softSilver,
    fontFamily: font.demi,
    fontSize: 24,
    marginBottom: 12,
  },
  tvFeedbackChoice: {
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 3,
    minHeight: 74,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  tvChoiceText: {color: color.silver, fontFamily: font.demi, fontSize: 23},
  tvFeedbackConfirmation: {gap: 24},
});
