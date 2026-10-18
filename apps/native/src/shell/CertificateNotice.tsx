import React, {useEffect, useState} from 'react';
import {useI18n} from '../app/i18n';
import {useFreshness} from '../app/freshness';
import {hasRealOrigin, useSession} from '../app/session';
import {acceptPendingCertificate, certificateOrigin, onCertificateQuestion, type PendingCertificate} from '../bridge/certificate-trust';
import {certificateTrustAvailable, nativeCertificatePlatform} from '../bridge/server-connections';
import {ConfirmSheet, showToast} from '../ui';

/**
 * The server's certificate changed while the app is signed in, to one the server couldn't prove
 * is the same server's: the question the sign-in screen asks, asked where the person is. Trusting
 * it is their choice; afterwards every open screen reads again. "Not now" leaves requests failing
 * with the plain message, and the same certificate is not asked about again this session.
 * While a saved sign-in is still resuming (after a restart the app has no connection yet and shows
 * "Can't reach"), the question about the saved server is asked here too, and trusting resumes it.
 */
export function CertificateNotice() {
  const i18n = useI18n();
  const session = useSession();
  const {api} = session;
  const {hub} = useFreshness();
  const [asked, setAsked] = useState<PendingCertificate>();
  const [declined] = useState(() => new Set<string>());
  const resuming = !hasRealOrigin(api) && session.saved ? session.saved : undefined;
  const origin = certificateOrigin(resuming && session.recovery ? session.recovery.serverUrl : api.baseUrl);
  useEffect(() => {
    if (!origin || !certificateTrustAvailable()) return;
    return onCertificateQuestion(question => {
      if (question.origin === origin && !declined.has(question.fingerprint)) setAsked(question);
    });
  }, [origin, declined]);
  if (!asked) return null;
  return (
    <ConfirmSheet
      open
      tone="default"
      title={i18n.t('connection.certificate.question')}
      consequence={i18n.t(asked.reason === 'changed' ? 'connection.certificate.changed' : 'connection.certificate.unverified')}
      confirmLabel={i18n.t('connection.certificate.trust')}
      onDismiss={() => { declined.add(asked.fingerprint); setAsked(undefined); }}
      onConfirm={async () => {
        if (await acceptPendingCertificate(asked.origin, nativeCertificatePlatform)) {
          showToast({message: i18n.t('connection.certificate.trusted'), icon: 'check'});
          if (resuming) resuming.retry(); else hub.resync();
        }
        setAsked(undefined);
      }}
    />
  );
}
