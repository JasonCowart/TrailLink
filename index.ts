// Entry point. Order matters: crypto polyfill first, then the background GPS task, then the app.
import { install } from 'react-native-quick-crypto';
install(); // provides globalThis.crypto (WebCrypto) used for end-to-end encryption

import './src/app/location.ts'; // defines the background location task at startup
import { registerRootComponent } from 'expo';
import App from './src/App.tsx';

registerRootComponent(App);
