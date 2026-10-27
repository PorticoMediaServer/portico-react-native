import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {screenModule} from './helpers/screen-harness.mjs';

test('screenModule links actual import declarations, including namespaces and side effects', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'portico-screen-imports-'));
  try {
    // This controlled transform supplies its own JSX mode and must not discover the
    // platform project's unavailable compiler configuration.
    await writeFile(join(scratch, 'tsconfig.json'), JSON.stringify({extends: 'missing-platform-config'}));
    const file = pathToFileURL(join(scratch, 'fixture.tsx'));
    await writeFile(file, `import 'side-effect';
      import Default, {fact as alias} from 'facts';
      import * as namespace from 'facts';
      // import Example from 'a-comment';
      export const message = "import Example from 'a-string';";
      export const result = [Default, alias, namespace.fact];`);
    const namespaces = {react: {default: {}}, 'side-effect': {}, facts: {default: 'default', fact: 'real'}};
    const linked = await screenModule(file, namespaces);
    assert.deepEqual(linked.result, ['default', 'real', 'real']);
    assert.equal(linked.message, "import Example from 'a-string';");
    const missing = {...namespaces} as Partial<typeof namespaces>;
    delete missing['side-effect'];
    await assert.rejects(screenModule(file, missing), /no namespace for side-effect/);
  } finally {
    await rm(scratch, {recursive: true});
  }
});
