import React from 'react';
import {KeyboardAvoidingView, ScrollView, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Atmosphere, Button, Notice, Text, Wordmark, keyboardAvoidance, useTheme} from '../../ui';
import {useI18n} from '../../app/i18n';
import {useSession} from '../../app/session';
import {useKeyboardAvoidanceEnabled} from '../../ui/keyboard-avoidance';

/**
 * Shared frame for every pre-authentication screen: atmosphere, wordmark,
 * a left-aligned column on handheld and a centred column on television.
 */
export function AuthFrame({title, lead, children, onBack, error, onDismissError, footer, wide, centered, compact}: {/** A first screen with a lot on it: tighter spacing so a phone shows it whole. */ compact?: boolean; title: string; lead?: string; children?: React.ReactNode; onBack?: () => void; error?: string; onDismissError?: () => void; footer?: React.ReactNode; /** A television landing that needs the width of the screen. */ wide?: boolean; centered?: boolean}) {
  const i18n = useI18n();
  const {space, isTV, window} = useTheme();
  const note = useSession().signInNote;
  const insets = useSafeAreaInsets();
  const keyboardAvoidanceEnabled = useKeyboardAvoidanceEnabled();
  const width = Math.min(wide ? 1240 : isTV ? 720 : 560, window.width - space.page * 2);
  return (
    <View style={{flex: 1}}>
      <Atmosphere />
      {/* The atmosphere runs under the status bar; the form scrolls below it, so a form the
          keyboard pushes up never runs under the clock. */}
      <KeyboardAvoidingView style={{flex: 1, marginTop: insets.top}} behavior={keyboardAvoidance} enabled={keyboardAvoidanceEnabled}>
        <ScrollView contentContainerStyle={{flexGrow: 1, paddingHorizontal: space.page, paddingTop: Math.max(0, (isTV ? 60 : 0) - insets.top) + (compact ? space.md : space.xl), paddingBottom: insets.bottom + (compact ? space.md : space.xxl), // APL-AUTH-10: centred on television, iPad and landscape phones; left-aligned only on a narrow phone.
          alignItems: isTV || window.width >= 700 ? 'center' : 'flex-start', justifyContent: 'center'}} keyboardShouldPersistTaps="handled">
          <View style={{width, gap: compact ? space.md : space.lg}}>
            {onBack ? <Button variant="ghost" size="sm" icon="back" label={i18n.t('action.back')} onPress={onBack} style={{marginLeft: -space.sm}} /> : null}
            <View style={{marginBottom: compact ? 0 : space.sm, alignItems: centered ? 'center' : 'flex-start'}}><Wordmark height={centered ? 64 : isTV ? 44 : 30} /></View>
            <Text variant={isTV ? 'display' : 'title'} align={centered ? 'center' : undefined}>{title}</Text>
            {lead ? <Text variant="body" tone="secondary" align={centered ? 'center' : undefined}>{lead}</Text> : null}
            {/* A sign-in that ended says so quietly here, never as a banner in the shell (Justin, 23 Sep). */}
            {note && !error ? <Text variant="body" tone="secondary" align={centered ? 'center' : undefined}>{note}</Text> : null}
            {error ? <Notice tone="danger" message={error} action={onDismissError ? i18n.t('action.dismiss') : undefined} onAction={onDismissError} /> : null}
            {children}
            {footer ? <View style={{marginTop: space.md}}>{footer}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
