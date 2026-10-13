import '@bacons/text-decoder/install';
import 'react-native-url-polyfill/auto';
import {AppRegistry} from 'react-native';
import {Root} from './src/Root';
import '../native/src/app/error-capture';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => Root);
