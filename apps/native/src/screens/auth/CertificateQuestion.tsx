import React, {useState} from 'react';
import {useI18n} from '../../app/i18n';
import {acceptPendingCertificate, pendingCertificate} from '../../bridge/certificate-trust';
import {certificateTrustAvailable, nativeCertificatePlatform} from '../../bridge/server-connections';
import {Button, Text} from '../../ui';

/**
 * Under a failed connection to an address: the one question Portico asks about an owner's own
 * certificate. It appears only when the certificate changed to one the server couldn't prove
 * (the error above says why), and trusting it is the person's choice. On a device that cannot
 * trust a server's own certificate (Vega), a failed connection to an https address says so.
 */
export function CertificateQuestion({origin, shown, connectionFailed, onTrusted}: {origin: string; shown: boolean; connectionFailed?: boolean; onTrusted: () => void}) {
  const i18n = useI18n();
  const [busy, setBusy] = useState(false);
  if (!shown) return null;
  if (!certificateTrustAvailable()) {
    return connectionFailed && /^\s*https:\/\//i.test(origin) ? <Text variant="caption" tone="tertiary">{i18n.t('connection.certificate.unsupported')}</Text> : null;
  }
  if (!pendingCertificate(origin)) return null;
  const trust = async () => {
    setBusy(true);
    try {
      if (await acceptPendingCertificate(origin, nativeCertificatePlatform)) onTrusted();
    } catch {
      // Nothing was pinned; the error above still stands and the question stays.
    } finally {
      setBusy(false);
    }
  };
  return <Button variant="secondary" label={i18n.t('connection.certificate.trust')} fullWidth loading={busy} onPress={() => void trust()} />;
}
