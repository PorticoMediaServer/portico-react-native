import './src/app/legacy-events';
import './src/bridge/random-id';
import '@bacons/text-decoder/install';
import 'react-native-url-polyfill/auto';
import './src/app/error-capture';
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
