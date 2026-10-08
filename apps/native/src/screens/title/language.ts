import {useCallback} from 'react';
import type {MessageId} from '../../../../../packages/i18n/src/index';
import {languageKey} from '../../../../../packages/client-core/src/presentation/index';
import {useI18n} from '../../app/i18n';
import {languageName} from '../settings/language-list';

/** "fra" → "French": a track's language as a name, from the catalogue first (Hermes may lack `Intl.DisplayNames`). */
export function useLanguageName(): (code: string) => string {
  const i18n = useI18n();
  return useCallback((code: string) => {
    const key = languageKey(code) || code;
    return languageName(key, k => { const v = i18n.t(k as MessageId); return v && v !== k ? v : undefined; });
  }, [i18n]);
}
