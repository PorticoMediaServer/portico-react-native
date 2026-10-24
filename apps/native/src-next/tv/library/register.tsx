import React from 'react';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {savedViewSummary} from '../../../../../packages/client-core/src/presentation/saved-view-summary';
import {registerNativeTVLibrary} from './module';
import {NativeTVSaveViewKeyboard} from './SaveViewKeyboard';

registerNativeTVLibrary({
  suggestName: (definition, capabilities) => savedViewSummary(definition, capabilities, defaultI18n)?.suggestedName,
  renderNaming: ({controller}, _runtime, onBack) => <NativeTVSaveViewKeyboard controller={controller} onBack={onBack}/>,
});
