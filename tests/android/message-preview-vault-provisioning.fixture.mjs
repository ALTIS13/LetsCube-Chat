import { readFileSync } from 'node:fs';
import { initializerStubs } from './message-preview-pristine-initializer-stubs.fixture.mjs';

// Labeled JVM Android API doubles, reused without replaying their old suites.
export const provisioningStubs = {
  ...initializerStubs,
  'android/app/Application.java': 'package android.app; public abstract class Application extends android.content.Context {}',
};
for (const name of ['KeyInfo', 'KeyProperties']) {
  provisioningStubs[`android/security/keystore/${name}.java`] = readFileSync(new URL(
    `../fixtures/native-message-preview-keystore-reader/android/security/keystore/${name}.java`, import.meta.url), 'utf8');
}
