import type React from 'react';
import type {ViewProps} from '@amazon-devices/react-native-kepler';

// Q43's existing glassRecipe selects the drawn translucent fill on Vega TV.
// No native backdrop-blur module exists here. Fail if a caller crosses that
// platform boundary rather than pretending to render a blur.
type BlurProps = ViewProps & {blurType?: string; blurAmount?: number; overlayColor?: string; reducedTransparencyFallbackColor?: string};
export function BlurView(_props: BlurProps): React.ReactElement {
  throw new Error('Vega TV does not provide native backdrop blur');
}
