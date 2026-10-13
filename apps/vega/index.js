import '@bacons/text-decoder/install';
import 'react-native-url-polyfill/auto';
// As the Apple and Android entry does: request ids for shared services that are not handed an id
// source of their own, where the runtime has no `crypto.randomUUID`.
import '../native/src/bridge/random-id';
import {AppRegistry} from 'react-native';
import {Root} from './src/Root';
import '../native/src/app/error-capture';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => Root);
