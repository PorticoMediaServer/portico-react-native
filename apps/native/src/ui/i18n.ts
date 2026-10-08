import {serviceI18n} from '../../../../packages/client-core/src/presentation/service-text';

/**
 * The viewer's catalogue for ui primitives (labels, accessibility text). `useI18n` in app/ installs
 * it (region preferences, system languages); before any screen mounts it is en-US.
 */
export const uiI18n = () => serviceI18n();
