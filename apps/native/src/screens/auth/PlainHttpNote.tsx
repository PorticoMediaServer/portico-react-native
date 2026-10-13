import React, {useEffect, useState} from 'react';
import {Linking} from 'react-native';
import type {HttpLocalApi} from '../../../../../packages/client-core/src/index';
import {SECURE_CONNECTION_HELP_URL} from '../../../../../packages/client-core/src/connection-note';
import {addressSaysPlainHttp, serverSaysPlainHttp} from '../../app/plain-http-note';
import {useI18n} from '../../app/i18n';
import {nativeNetworkFetch} from '../../bridge/server-connections';
import {Text, useTheme} from '../../ui';

/**
 * One quiet line on a sign-in screen when the server says this device reaches it over plain HTTP
 * from outside the owner's home networks. It never blocks or interrupts: signing in works exactly
 * the same with or without it.
 *
 * `api`: the server this screen is already talking to. `address`: what was typed, once the person
 * has finished typing it (the screen passes it when the address field is left); an empty one asks nothing.
 */
export function PlainHttpNote({api, address}: {api?: Pick<HttpLocalApi, 'connection'>; address?: string}) {
  const i18n = useI18n();
  const {isTV, colors} = useTheme();
  const [show, setShow] = useState(false);
  const typed = address?.trim() ?? '';
  useEffect(() => {
    setShow(false);
    if (!api && !typed) return;
    const abort = new AbortController();
    void (api ? serverSaysPlainHttp(api, abort.signal) : addressSaysPlainHttp(typed, nativeNetworkFetch, abort.signal)).then(yes => { if (!abort.signal.aborted && yes) setShow(true); });
    return () => abort.abort();
  }, [api, typed]);
  if (!show) return null;
  // Television has no browser to open: the sentence stands by itself there.
  if (isTV) return <Text variant="caption" tone="tertiary" align="center">{i18n.t('web.connectivity.httpOutsideHome')}</Text>;
  return (
    <Text variant="caption" tone="tertiary">
      {`${i18n.t('web.connectivity.httpOutsideHome')} `}
      <Text accessibilityRole="link" suppressHighlighting onPress={() => void Linking.openURL(SECURE_CONNECTION_HELP_URL).catch(() => {})} style={{color: colors.accent, textDecorationLine: 'underline'}}>{i18n.t('signIn.plainHttp.link')}</Text>
    </Text>
  );
}
