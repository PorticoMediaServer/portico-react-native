import React, {useEffect, useState} from 'react';
import type {HttpLocalApi} from '../../../../../packages/client-core/src/index';
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
  const {isTV} = useTheme();
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
  // Where the owner turns it on is said in the line itself: there is no help page to open.
  return <Text variant="caption" tone="tertiary" {...(isTV ? {align: 'center' as const} : {})}>{`${i18n.t('web.connectivity.httpOutsideHome')} ${i18n.t('signIn.plainHttp.owner')}`}</Text>;
}
