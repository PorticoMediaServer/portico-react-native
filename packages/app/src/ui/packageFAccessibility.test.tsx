import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import {ControlButton, IconButton} from './primitives';

describe('Package F mounted accessibility semantics', () => {
  test('publishes selected, disabled, and busy state on the actual shared controls', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<>
        <ControlButton busy label="Saving choice" onPress={jest.fn()} platform="mobile" selected />
        <IconButton disabled icon="action.confirm" label="Unavailable action" onPress={jest.fn()} platform="mobile" />
      </>);
    });
    const saving = tree.root.find(node => typeof node.type === 'string'
      && node.props?.accessibilityRole === 'button'
      && node.props.accessibilityLabel === 'Saving choice');
    const unavailable = tree.root.find(node => typeof node.type === 'string'
      && node.props?.accessibilityRole === 'button'
      && node.props.accessibilityLabel === 'Unavailable action');
    expect(saving.props.accessibilityState).toEqual({busy: true, disabled: true, selected: true});
    expect(unavailable.props.accessibilityState).toEqual({busy: undefined, disabled: true, selected: undefined});
  });

  test('allows mobile control labels to expand for Dynamic Type', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ControlButton label="A deliberately long action label" onPress={jest.fn()} platform="mobile" />);
    });
    const label = tree.root.findAllByType(Text).find(node => node.props.children === 'A deliberately long action label');
    expect(label?.props.numberOfLines).toBeUndefined();
  });
});
