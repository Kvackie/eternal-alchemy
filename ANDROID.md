# Building the Android APK

For private use — sideloaded, not through the Play Store. No signing key, no store listing.

## What is already done

- `capacitor.config.json` is configured (app id `com.eternalalchemy.shop`, dark background to match
  the game so there is no white flash on launch).
- `@capacitor/core`, `@capacitor/preferences` and `@capacitor/android` are installed.
- `@capacitor/cli` is a dev dependency, so `npx cap` works after `npm install`.
- The `android/` project is **not** in the repository: it is generated and gitignored. It was created
  once with `npx cap add android`, and anyone starting from a fresh clone runs that once themselves.
  `cap sync` updates an existing project; it does not create one.
- The save system already switches to Capacitor Preferences on device. See the note below.

## What you need installed

Only for building locally. The workflow below needs neither, since GitHub's runner has both:

1. **JDK 21** — Temurin is the usual choice: <https://adoptium.net>
2. **Android SDK** — either Android Studio (easiest), or the command-line tools plus
   `platform-tools` and `platforms;android-36`.

Then set the environment variables:

```powershell
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-21..."
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
```

Open a fresh terminal afterwards so they take effect.

## Building without installing anything: the workflow

GitHub builds the APK for you. In the repository's **Actions** tab, pick **Android APK** and press
**Run workflow**. It runs the tests, builds the web bundle, generates the native project, runs
Gradle with JDK 21, and attaches `app-debug.apk` to the run as an artifact called
`eternal-alchemy-debug-apk`. Download it from the run's summary page, unzip it and copy the APK to
the phone. It only ever runs when started by hand. The workflow is
`.github/workflows/android.yml`.

## The icon and the splash

The launcher icon and the splash screen are the golden flask from the potion art on the game's
plum-black ground. Because `android/` is generated, they are painted into it rather than committed:
`npm run android:assets` (`scripts/android-assets.js`) redraws every launcher icon and splash image
the template ships, at each one's own size, sets the adaptive icon's background colour, and makes
Android 12's system splash use the same ground so a launch never opens on white. The workflow runs it
after `cap add`; on your own machine, run it once after `npx cap add android`. `cap sync` leaves
these files alone, so it does not need running again.

## Building on your own machine

```
npm run android:apk
```

That builds the web bundle, copies it into the native project, and runs Gradle.

**This script is Windows-only.** It ends in `gradlew.bat`, which is the Windows wrapper — on macOS
or Linux run the sync and the wrapper separately:

```
npm run android:sync
cd android && ./gradlew assembleDebug
```

The debug APK lands at:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Copy it to the phone and open it. Android will warn about installing from an unknown source — that
is expected for a sideloaded debug build.

Other scripts:

| Script | Does |
| --- | --- |
| `npm run android:sync` | Rebuild the web bundle and copy it into the native project |
| `npm run android:open` | Open the project in Android Studio |
| `npm run android:run` | Build, sync, and launch on a connected device or emulator |

Run `android:sync` after **any** change to the game — the native project holds a *copy* of `dist/`,
so a rebuild alone does not reach the device.

## How saving works on device

`src/platform/storage.ts` picks the backend at runtime. On the web it uses `localStorage`; on device
it uses Capacitor Preferences, which survives an OS cache clear that would wipe `localStorage`. For a
local-only save with no cloud backup, that difference is the difference between keeping a forty-hour
game and losing it.

The plugin is reached through the **injected `Capacitor.Plugins.Preferences` global**, not an
`import`. A bare module specifier is not resolvable in a WebView any more than in a browser, so
importing it would either drag Capacitor into the web bundle or 404 on device. The npm package is
still required — `cap sync` reads it to install the native Android half.

The adapter keeps a synchronous in-memory mirror over the asynchronous plugin, because saving happens
inside game actions and must not be something a caller can forget to await. `storageReady()` is
awaited once at boot so the first read sees real data rather than an empty store.

## Not done

- **No APK has been run on a device yet.** The workflow builds one: its first run, on 24 September
  2026, went green end to end in about two minutes and attached a debug APK. Nobody has installed
  that APK on a phone yet.
- No release signing. A debug APK is correct for private sideloading; a release build would need a
  keystore.
