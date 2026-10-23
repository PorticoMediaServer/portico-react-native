import React, {forwardRef} from 'react';
import MaskedView from '@amazon-devices/react-native-masked-view__masked-view';

/** The SDK supports the mask; androidRenderingMode belongs only to Android. */
export default forwardRef<React.ComponentRef<typeof MaskedView>, React.ComponentProps<typeof MaskedView>>(function VegaMaskedView({androidRenderingMode: _androidMode, ...props}, ref) {
  return <MaskedView {...props} ref={ref} />;
});
