import {defaultI18n, type I18n, type MessageId} from '../../../../../packages/i18n/src';
import {browseNameId} from '../../../../../packages/client-core/src/presentation/browse-toolbar';

/** The row's own canonical vocabulary, named by the translator the caller currently shows. */
export function homeBrowseLabel(value: {id: string; labelKey?: string}, i18n: Pick<I18n, 't' | 'has'> = defaultI18n): string {
  const id = browseNameId(value.id, value.labelKey, i18n.has);
  if (!id) throw Object.assign(new Error('native_browse_copy_unavailable'), {code: 'invalid_response'});
  return i18n.t(id as MessageId);
}
