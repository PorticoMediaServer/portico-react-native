import {createTVRailTabModel} from './tvNavigationRail';

function fixture() {
  const emitted: Array<Record<string, unknown>> = [];
  const navigated: Array<[string, Readonly<Record<string, unknown>> | undefined]> = [];
  return {
    emitted,
    navigated,
    navigation: {
      emit: (event: Record<string, unknown>) => {
        emitted.push(event);
        return {};
      },
      navigate: (name: string, params?: Readonly<Record<string, unknown>>) => {
        navigated.push([name, params]);
      },
    },
    state: {
      index: 1,
      routes: [
        {key: 'home-key', name: 'Home'},
        {key: 'library-key', name: 'Library', params: {libraryId: 'movies'}},
        {key: 'channels-key', name: 'Channels'},
        {key: 'saved-key', name: 'Saved'},
      ],
    },
  };
}

describe('createTVRailTabModel', () => {
  it('derives selection from standard tab state', () => {
    const setup = fixture();
    const model = createTVRailTabModel(setup.state, setup.navigation);
    expect(model.activeName).toBe('Library');
    expect(model.items.map(item => [item.name, item.focused])).toEqual([
      ['Home', false],
      ['Library', true],
      ['Channels', false],
      ['Saved', false],
    ]);
  });

  it('emits tabPress before navigating and restores focus on reselect without resetting the stack', () => {
    const setup = fixture();
    const reselect = jest.fn();
    const model = createTVRailTabModel(setup.state, setup.navigation, undefined, reselect);
    model.items[0]!.onPress();
    expect(setup.emitted).toEqual([{
      canPreventDefault: true,
      target: 'home-key',
      type: 'tabPress',
    }]);
    expect(setup.navigated).toEqual([['Home', undefined]]);

    model.items[1]!.onPress();
    expect(setup.navigated).toHaveLength(1);
    expect(setup.emitted).toHaveLength(1);
    expect(reselect).toHaveBeenCalledWith('Library');
  });

  it('honors prevented tab navigation', () => {
    const setup = fixture();
    setup.navigation.emit = event => {
      setup.emitted.push(event);
      return {defaultPrevented: true};
    };
    const model = createTVRailTabModel(setup.state, setup.navigation);
    model.items[3]!.onPress();
    expect(setup.navigated).toEqual([]);
  });

  it('never exposes Downloads or secondary screens in the television rail', () => {
    const setup = fixture();
    const model = createTVRailTabModel({
      ...setup.state,
      routes: [...setup.state.routes, {key: 'downloads', name: 'Downloads'}, {key: 'detail', name: 'Detail'}],
    }, setup.navigation);
    expect(model.items.map(item => item.name)).toEqual(['Home', 'Library', 'Channels', 'Saved']);
  });
});
