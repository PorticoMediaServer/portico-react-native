import React from 'react';
import {TVFocusGuideView} from 'react-native';
import {useTheme} from '../../ui';

/**
 * TV-DETAIL-01: a row that spans the full width for the focus engine, so Down from any card in
 * the row above lands in it (on the card last used there, else the first), even when this row
 * has only one card at the left. Off television it renders its children.
 */
export function RowGuide({children}: {children: React.ReactNode}) {
  const {isTV} = useTheme();
  if (!isTV) return <>{children}</>;
  return <TVFocusGuideView autoFocus>{children}</TVFocusGuideView>;
}
