import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


platform = module('platform_tests', 'platform-tests.py')
android = module('android_harnesses', 'run-android-harnesses.py')


class PlatformInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tests = self.root / 'apps/native/test'
        self.tests.mkdir(parents=True)
        self.source = 'apps/native/test/apple-fixture-tests.m'
        (self.root / self.source).write_text('int main(void) { return 0; }\n')
        self.entries = [{'source': self.source, 'execution': 'owned-apple', 'owner': 'fixture', 'requirements': 'isolated simulator'}]
        self.manifest = self.root / 'platform-tests.json'
        self.manifest.write_text(json.dumps({'version': 1, 'apple': self.entries}))

    def test_each_platform_suite_requires_an_explicit_execution_owner(self):
        self.assertEqual(platform.inventory(self.root, self.manifest), self.entries)
        (self.tests / 'apple-new-tests.m').write_text('int main(void) { return 0; }\n')
        with self.assertRaisesRegex(ValueError, 'inventory mismatch'):
            platform.inventory(self.root, self.manifest)

    def test_duplicate_inventory_and_unknown_runner_are_refused(self):
        self.manifest.write_text(json.dumps({'version': 1, 'apple': self.entries * 2}))
        with self.assertRaises(ValueError):
            platform.inventory(self.root, self.manifest)
        self.entries[0]['execution'] = 'unowned'
        self.manifest.write_text(json.dumps({'version': 1, 'apple': self.entries}))
        with self.assertRaisesRegex(ValueError, 'Unknown test execution'):
            platform.inventory(self.root, self.manifest)

    def receipt(self):
        return {'revision': 'a' * 40, 'tests': [{
            'source': self.source, 'status': 'passed', 'assertions': 3,
            'platform': 'ios-simulator', 'deviceOrSimulatorSet': 'disposable-fixture',
            'resultArtifact': 'result.json',
            'testSha256': hashlib.sha256((self.root / self.source).read_bytes()).hexdigest(),
        }]}

    def test_owned_receipts_require_revision_source_and_positive_assertions(self):
        receipt = self.receipt()
        platform.owned_receipts(self.entries, receipt, 'a' * 40, self.root)
        for key, bad in [('status', 'skipped'), ('assertions', 0), ('assertions', True),
                         ('deviceOrSimulatorSet', ''), ('testSha256', 'b' * 64)]:
            with self.subTest(key=key, bad=bad):
                changed = self.receipt()
                changed['tests'][0][key] = bad
                with self.assertRaises(ValueError):
                    platform.owned_receipts(self.entries, changed, 'a' * 40, self.root)
        with self.assertRaises(ValueError):
            platform.owned_receipts(self.entries, receipt, 'b' * 40, self.root)
        with self.assertRaises(ValueError):
            platform.owned_receipts(self.entries, {'revision': 'a' * 40, 'tests': []}, 'a' * 40, self.root)

    def test_compile_failure_is_reported_and_remaining_suites_still_execute(self):
        entries = [{'source': self.source, 'execution': 'macos-foundation', 'frameworks': ['Foundation']},
                   {'source': 'apps/native/test/apple-second-tests.m', 'execution': 'macos-foundation', 'frameworks': ['Foundation']}]
        output = self.root / 'results'
        # First compile fails, second compile and executable succeed.
        answers = [1, 0, 0]
        with patch.object(platform, 'run_bounded', side_effect=answers) as run:
            self.assertEqual(platform.foundation(entries, output, self.root), 1)
        self.assertEqual(run.call_count, 3)
        report = json.loads((output / 'results.json').read_text())
        self.assertEqual([row['exit'] for row in report], [1, 0])
        self.assertEqual(len(list(output.glob('*.log'))), 2)

    def test_android_failure_keeps_other_harnesses_and_all_reports(self):
        for name, text in [('first.py', 'raise SystemExit(7)'), ('second.py', 'import sys\nprint("actual second suite executed", sys.argv[1:])')]:
            (self.root / name).write_text(text)
        output = self.root / 'android-results'
        with patch.object(android, 'HARNESSES', ('first.py', 'second.py')):
            self.assertEqual(android.run(self.root, output), 1)
        report = json.loads((output / 'results.json').read_text())
        self.assertEqual([row['exit'] for row in report], [7, 0])
        second = (output / 'second.log').read_text()
        self.assertIn('actual second suite executed', second)
        self.assertIn("'--scratch', '" + str(output / 'second-scratch') + "'", second)



class OwnedAppleRunnerTests(unittest.TestCase):
    """C03: the owned runner's verdicts and receipts, without a Mac."""

    def setUp(self):
        self.runner = module('run_owned_apple', 'run-owned-apple.py')
        self.platform = module('platform_tests_for_runner', 'platform-tests.py')

    def test_a_suite_passes_only_on_exit_zero_and_a_clean_json_summary(self):
        outcome = self.runner.outcome
        self.assertEqual(outcome('noise\n{"assertions":12,"failures":0}\n', 0), (True, 12))
        self.assertEqual(outcome('{"assertions":12,"failures":1}', 0), (False, 12))
        self.assertEqual(outcome('{"assertions":0,"failures":0}', 0), (False, 0))
        self.assertEqual(outcome('{"assertions":12,"failures":0}', 1), (False, 0))
        self.assertEqual(outcome('{"fooPass":true,"barPass":true,"rate":44100}', 0), (True, 2))
        self.assertEqual(outcome('{"fooPass":true,"barPass":false}', 0), (False, 2))
        self.assertEqual(outcome('{"rate":44100}', 0), (False, 0))
        self.assertEqual(outcome('no summary', 0), (False, 0))
        self.assertEqual(outcome('{"assertions":true}', 0), (False, 0))

    def test_every_owned_suite_has_a_recipe_or_a_stated_reason(self):
        recipes = json.loads(self.runner.RECIPES.read_text())
        self.assertEqual(set(recipes), set(self.runner.owned_sources()))
        for source, recipe in recipes.items():
            self.assertTrue(recipe.get('runnable') or recipe.get('reason'), source)
            command, reason = self.runner.plan(source, recipe, Path('/tmp/work'), None)
            self.assertTrue(command is not None or reason, source)

    def test_receipts_list_only_passed_suites_and_the_validator_refuses_an_incomplete_set(self):
        sources = self.runner.owned_sources()
        results = {source: {'status': 'passed', 'assertions': 3} for source in sources}
        revision = 'a' * 40
        document = self.runner.receipt(revision, results, 'macOS 26; iOS simulator', 'disposable', 'owned-apple.log')
        entries = self.platform.inventory()
        self.platform.owned_receipts(entries, document, revision)
        results[sources[0]] = {'status': 'not-run', 'reason': 'no recipe', 'assertions': 0}
        partial = self.runner.receipt(revision, results, 'macOS 26; iOS simulator', 'disposable', 'owned-apple.log')
        self.assertNotIn(sources[0], [row['source'] for row in partial['tests']])
        with self.assertRaisesRegex(ValueError, 'Missing owned Apple receipts'):
            self.platform.owned_receipts(entries, partial, revision)

if __name__ == '__main__':
    unittest.main()
