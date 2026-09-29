import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import { boot } from './boot';
import './index.css';
import { migrateStorage } from './lib/storage';

migrateStorage();
// Hydrates a pre-rendered page (with its inlined data), or renders the app shell.
boot(document);
