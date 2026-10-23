import React from 'react';
import {View, useWindowDimensions} from 'react-native';
import Animated from 'react-native-reanimated';
import {shellLayout} from '../../shell/model';
import {OverlayPortal, useOverlayLifecycle} from '../../kit/overlays/OverlayHost';
import {FocusBoundary, PanelBackground, SurfaceHeader, useSurfaceMotion} from '../../kit/overlays/surface';
import type {SidePanelProps} from '../../kit/overlays';

/** TVdetail8b is a760px authored panel in the same1920px canvas as its
 * underlying title. The overlay portal is outside the shell's canvas, so the
 * fit is applied here once, including focus rings, type, rows and footer. */
export function NativeWatchTVVersionPanel({open, onOpenChange, title, description, children, footer, initialFocusRef, returnFocusRef, testID,
  style, titleType, descriptionTextStyle}: SidePanelProps) {
  const window = useWindowDimensions(), canvas = shellLayout(window.width, window.height, true);
  const animation = useSurfaceMotion(open, 'side', 760);
  useOverlayLifecycle(animation.present, true, reason => onOpenChange(false, reason), initialFocusRef, returnFocusRef, animation.enterMs, testID);
  if (!animation.present || !Number.isFinite(canvas.scale) || canvas.scale <= 0) return null;
  const rect = {x: canvas.left + (1920 - 760) * canvas.scale, y: canvas.top, width: 760 * canvas.scale, height: 1080 * canvas.scale};
  return <OverlayPortal rect={rect}>
    <View pointerEvents="box-none" style={{position: 'absolute', inset: 0}}>
      <View testID="watch-version-tv-canvas" pointerEvents="box-none" style={{position: 'absolute', left: canvas.left, top: canvas.top, width: 1920, height: 1080, transformOrigin: 'top left', transform: [{scale: canvas.scale}]}}>
        <Animated.View testID={testID} style={[{position: 'absolute', top: 0, right: 0, bottom: 0, width: 760, paddingTop: 42, paddingBottom: 56, paddingLeft: 56, paddingRight: 96}, animation.style, style]}>
          <PanelBackground/>
          <FocusBoundary modal testID={testID} style={{flex: 1}}>
            <SurfaceHeader side title={title} description={description} titleType={titleType} descriptionTextStyle={descriptionTextStyle}/>
            <View style={{flex: 1}}>{children}</View>
            {footer && <View style={{paddingTop: 16}}>{footer}</View>}
          </FocusBoundary>
        </Animated.View>
      </View>
    </View>
  </OverlayPortal>;
}
