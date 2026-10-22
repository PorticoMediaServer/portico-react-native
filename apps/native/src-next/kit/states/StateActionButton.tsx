import React from 'react';
import {focusTestID} from '../focus/registry';
import {Button, type ButtonProps} from '../controls/Button';
import type {StateAction} from './types';

/** Keep semantic action IDs and copy out of the native Pressable's props. */
export function StateActionButton({action, ...props}: {action: StateAction} & Pick<ButtonProps, 'variant' | 'size' | 'style' | 'textStyle' | 'hitSlop' | 'iconSize' | 'testID'>) {
  const {id, label, ...native} = action;
  return <Button {...props} {...native} testID={native.testID ?? controlID(props.testID, 'action', id)}>{label}</Button>;
}

const controlID = (prefix: string | undefined, ...parts: readonly string[]) => prefix ? focusTestID(prefix, JSON.stringify(parts)) : undefined;
