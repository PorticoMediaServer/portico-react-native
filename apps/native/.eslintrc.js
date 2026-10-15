// The hook rules are errors here as in `npm run lint:hooks` (.eslintrc.hooks.cjs), which CI runs.
module.exports = {root: true, extends: '@react-native', rules: {'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error'}};
