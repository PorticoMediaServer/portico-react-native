import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule, hooks} from './helpers/screen-harness.mjs';
import {NativeShellRouteRegistry} from '../src-next/shell/route-registry.ts';

test('actual bound registry shares one Watch/title clock, Back and disposal per bootstrap authority', async () => {
  const {react} = hooks(), registry = new NativeShellRouteRegistry();
  let created = 0, disposed = 0;
  const {registerNativeWatch} = await screenModule(new URL('../src-next/screens/watch/register.ts', import.meta.url), {
    react, '../../shell/route-registry': {nativeShellRoutes: registry},
    './module': {createNativeWatchModule: (context: any, bindings: any) => {
      assert.equal(bindings.context, context); const identity = ++created;
      return {render: (runtime: any) => ({watch: identity, runtime}), title: {render: (route: any, runtime: any) => ({title: identity, route, runtime})},
        back: () => identity === 1, dispose: () => {disposed++;}};
    }},
  });
  const remove = registerNativeWatch((context: any) => ({context}));
  const context = {current: () => true, navigation: {allows: () => true}} as any;
  const first = registry.bind(context), second = registry.bind({...context});
  const route = {kind: 'title', entry: {id: 'actual', kind: 'movie', title: 'Actual'}} as any, runtime = {} as any;
  assert.equal(created, 0);
  assert.equal((first.render(route, runtime) as any).title, 1);
  assert.equal((first.renderWatch(runtime) as any).watch, 1);
  assert.equal(first.back(), true); assert.equal(created, 1);
  assert.equal((second.renderWatch(runtime) as any).watch, 2); assert.equal(second.back(), false);
  first.dispose(); first.dispose(); assert.equal(disposed, 1);
  remove(); assert.equal(disposed, 2);
  assert.equal(second.renderWatch(runtime), null); second.dispose(); assert.equal(disposed, 2);
});
