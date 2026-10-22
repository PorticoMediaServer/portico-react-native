import React from 'react';
import {Button, type ButtonProps} from '../controls';
import type {StateAction} from './types';

/** Keep semantic action IDs and copy out of the native Pressable's props. */
export function StateActionButton({action, ...props}: {action: StateAction} & Pick<ButtonProps, 'variant' | 'size' | 'style'>) {
  const {id: _id, label, ...native} = action;
  return <Button {...props} {...native}>{label}</Button>;
}
