# Installing this fork over the local macOS Hermes app

This records the successful desktop update on **2026-10-10** and the steps to
repeat it on this Mac. The fork's compiled desktop shell replaced the installed
app; it continued using the existing agent runtime, settings, and conversations.
For release installers and bundled runtimes, see [BUILDING.md](BUILDING.md).

## Installed result

| Item | Value at installation |
|---|---|
| Fork checkout | `/Users/artemshelmanov/workspace/projects/hermes` |
| Source base commit | `a62979dc3601c9eae455bff5b35ba8f9bed0df30` plus uncommitted popup changes |
| Build timestamp | `2026-10-10T15:38:30.771Z` |
| Installed app | `/Applications/Hermes.app` |
| Bundle identifier | `com.nousresearch.hermes` |
| Architecture / Electron | ARM64 / `40.10.2` |
| Signing | Local ad-hoc signature with hardened runtime; no notarization |
| Existing runtime used on launch | `/Users/artemshelmanov/.hermes/hermes-agent` |
| Existing desktop data | `/Users/artemshelmanov/Library/Application Support/Hermes` |
| Previous app backup | `.cache/hermes-app-backups/20261010T154446Z/Hermes.app` relative to this checkout |
| Popup shortcut | `mod+shift+h`, shown as **⌘⇧H** |

The build stamp declares `dirty: true`, `payload: bootstrap`, and
`updateMechanism: self`. The app's `0.0.0` bundle version does not identify the
agent revision. The existing backend displayed `v0.21.6+339` after reconnecting.

The shortcut is configurable under **Settings → Keyboard Shortcuts → Key bindings
→ Toggle HUD popup (global)**. Electron saves it in `hud-shortcut.json` inside
its existing user-data directory.

## 1. Build the current working tree

Run from the repository root. This route includes uncommitted desktop changes;
the clean, tagged bundle builder packages a different input contract.

The successful run used the Codex-provided Node `24.19.0`:

```sh
cd /Users/artemshelmanov/workspace/projects/hermes
export PATH="/Users/artemshelmanov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export npm_config_cache=/private/tmp/hermes-npm-cache
```

If workspace dependencies need installation, the command used was:

```sh
npx --yes npm@11.17.0 ci --ignore-scripts --no-audit --no-fund
node apps/desktop/node_modules/electron/install.js
```

The second command acquires the pinned Electron runtime after lifecycle scripts
were skipped. Node `25.9` and npm `11.12` on the host did not match the repository's
supported installation toolchain. Use a supported Node and npm if the recorded
Codex runtime path is no longer available.

```sh
npm run build --workspace apps/desktop
CSC_IDENTITY_AUTO_DISCOVERY=false npm run builder --workspace apps/desktop -- \
  --mac --dir --publish never
```

`build` produces `apps/desktop/dist`; `builder` produces
`apps/desktop/release/mac-arm64/Hermes.app`. The packaging wrapper prepares its
pinned tools and Electron archive; first-time preparation needs network access.
The update used this unpacked `.app`, without creating a DMG or ZIP.

Before committing, the repository's archive guard flagged supplier `.tar.gz`
files under the ignored `.cache/desktop-inputs/packager` directory. Moving that
download cache to `/private/tmp/hermes-packager-cache-20261010` allowed all 11
repository checks to pass. The installed app, prepared packaging inputs, and
rollback app backup were retained. On later builds, move generated supplier
archives outside the checkout before running the same guard.

## 2. Sign and verify the app

Two issues were encountered with the pinned `electron-builder 27.0.0-alpha.6`:

- The attempted override `-c.mac.identity=-` failed schema validation:
  `configuration.mac has an unknown property 'identity'`. It was removed.
- Packaging with automatic certificate discovery disabled succeeded, but left
  a linker signature that failed strict verification with
  `code has no resources but signature indicates they must be present`.

The successful workaround called the repository's own macOS signer explicitly
with identity `-`. This matches the existing app's local ad-hoc signing method,
retains the repository's entitlements and hardened runtime, and uses its
bounded binary-probe adapter. This is a workaround for the recorded dependency
version; recheck the packaging behavior after dependency upgrades.

Save this script as `/private/tmp/hermes-sign-local.mjs`:

```js
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const desktop = path.join(root, 'apps/desktop')
const require = createRequire(path.join(desktop, 'package.json'))
const config = require(path.join(desktop, 'electron-builder.config.cjs'))
const { MacTargetHelper } = await import(pathToFileURL(path.join(
  root, 'node_modules/app-builder-lib/dist/targets/mac/MacTargetHelper.js'
)).href)
const packager = {
  resourceList: Promise.resolve([]),
  buildResourcesDir: path.join(desktop, 'build')
}
packager.helper = new MacTargetHelper(packager)
await config.mac.sign({
  app: path.join(desktop, 'release/mac-arm64/Hermes.app'),
  identity: '-',
  identityValidation: false,
  platform: 'darwin',
  type: 'distribution',
  version: require(path.join(desktop, 'package.json')).devDependencies.electron,
  preAutoEntitlements: false
}, packager)
```

Run it from the repository root, then verify:

```sh
node --import ./apps/desktop/scripts/patch-electron-builder-mac-binary.mjs \
  /private/tmp/hermes-sign-local.mjs
codesign --verify --deep --strict --verbose=2 \
  apps/desktop/release/mac-arm64/Hermes.app
codesign -dv apps/desktop/release/mac-arm64/Hermes.app
```

Verification passed with identifier `com.nousresearch.hermes`, an ad-hoc
signature, hardened runtime, and sealed resources. Apple notarization was
skipped because its credentials were not configured. No Gatekeeper or system
security settings were changed.

## 3. Replace the app and keep a rollback copy

Fully quit Hermes before replacement. The installation found no running
`/Applications/Hermes.app/Contents/MacOS/Hermes` process. Check the executable
path directly rather than matching unrelated command-line substrings.

The installation transaction was:

1. Hash the existing desktop user-data JSON files.
2. Copy the verified new app with `ditto` into a fresh hidden staging path under
   `/Applications`, such as `/Applications/.Hermes-popup-TIMESTAMP.app`.
3. Run `codesign --verify --deep --strict` against that staged copy.
4. Move `/Applications/Hermes.app` to a fresh
   `.cache/hermes-app-backups/TIMESTAMP/Hermes.app` in this checkout.
5. Rename the staged app to `/Applications/Hermes.app`. If that rename fails,
   move the backup back to the original installation path.
6. Verify the installed signature, bundle identifier, and main-bundle SHA-256
   against the packaged source. Confirm the user-data JSON hashes still match.

This Mac allowed the backup move between `/Applications` and the checkout.
For a checkout on another filesystem, copy and verify the backup before moving
the original app to a rollback location on the same filesystem as `/Applications`.

Only the app bundle was replaced. The installation preserved all **13 existing
desktop JSON settings files**, and kept the existing Electron data directory and
agent state. It did not update the installed agent checkout or run `hermes update`.
The stable app name and bundle identifier were retained so the new shell reused
the same desktop data and connection settings.

## 4. Verify after launching

Open `/Applications/Hermes.app`, then check:

- The desktop log reports the existing runtime being used and
  `Hermes backend is ready. Finalizing desktop startup`.
- The UI shows **Backend ready**, and existing conversations are present.
- Keyboard Shortcuts contains **Toggle HUD popup (global)** with **⌘⇧H** and
  no registration error.
- `hud-shortcut.json` contains `{"combo":"mod+shift+h"}`.
- The installed `Contents/Resources/install-stamp.json` matches the fork build.
- These files have identical SHA-256 hashes:
  `apps/desktop/dist/electron-main.mjs` and
  `/Applications/Hermes.app/Contents/Resources/app.asar.unpacked/dist/electron-main.mjs`.

All of these installation checks passed. Before delivery, 63 focused tests,
TypeScript checks, desktop lint, repository checks, and the build passed. A
native macOS fixture also confirmed actual OS shortcut registration. Automated
cross-app keypress testing was inconclusive, so a manual cross-app toggle test
was not claimed as verified.

The temporary logs and receipt used were:

- `/private/tmp/hermes-popup-build-delivery.log`
- `/private/tmp/hermes-popup-package.log`
- `/private/tmp/hermes-popup-sign.log`
- `/private/tmp/hermes-popup-install-receipt.json`

Those temporary files may disappear; the installation facts and procedure are
preserved in this document.

## Rollback and future updates

To roll back, quit Hermes, move the current app to a new recovery location, and
restore the saved `Hermes.app` to `/Applications/Hermes.app`. Verify its signature
and reopen it. Keep both app bundles until the restored app is confirmed working;
the backup is an ignored local directory and must be retained for rollback.

This customization lives in this fork. An ordinary upstream `hermes update`
can rebuild the desktop from the installed agent checkout and replace the custom
app. To install later changes from this fork, repeat this build, sign, verify,
and replacement procedure with a fresh backup.
