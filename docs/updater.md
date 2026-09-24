# Signed updates (Windows / Android)

## Architecture and user experience

Ryokan uses the official Tauri v2 updater, registered and permitted **only on Windows**.
The stable feed is `https://github.com/Finn-Hecker/RyokanApp/releases/latest/download/latest.json`.
Tauri compares the manifest version to the running app version (no downgrade override).
The frontend additionally rejects prerelease versions. GitHub's latest release must be a
stable release containing the manifest, even when adding Android assets later.

One shared store owns the native update resource and serializes checks, downloads, and
installation across Settings navigation. A single nonblocking startup check shows a
small lobby notice if an update exists. Settings → Advanced → App updates shows the
actual native version, manual check, download progress, and **Install and restart**.
Download completion is not treated as verification: installation becomes available
only after Tauri's download promise succeeds, including signature verification.
`requireSignedVersion` also binds the manifest version to the signed artifact version,
preventing a modified manifest from advertising an older signed installer as newer.
This requires Tauri CLI 2.11.5+ and updater 2.12.0+ (recorded in the dependency locks).
No update installs without a user click. EN/DE messages use the existing Paraglide setup.
There is no telemetry, periodic polling, or custom update service.

Checks time out after 15 seconds; downloads after 5 minutes. Missing releases (including
the current 0.5 release without `latest.json`), bad metadata, offline requests, failed
downloads/signatures, and installer-launch errors show retryable messages. Failed
downloads/install attempts discard the native resource and require a fresh check.
Startup failures do not interrupt normal use. A verified download remains available
when leaving Settings, but is not persisted across app exits.

Windows uses the NSIS installer in passive mode. **Tauri exits the application after
successfully launching the installer; the installer restarts it.** There is no extra
process/relaunch plugin and no premature restart of the old executable. Errors after
handoff cannot be reported by the now-closed app: use the installer UI, reopen the app
and inspect its version, or run the signed release installer manually. Save edits and
finish sessions before installation. There is no automatic rollback guarantee.

Existing 0.5 binaries have no updater and require a one-time manual installation of
the first updater-enabled release. Production package/Cargo/Tauri versions remain
unchanged by this implementation and by all test configuration overrides.

## One-time signing / GitHub setup

1. Generate a **production** updater signing key on a trusted machine, outside the
   repository: `npm run tauri -- signer generate -w C:\secure\ryokan-updater.key`.
   Use a password and keep an encrypted offline backup of both key and password.
   Never commit the private key or put it in an issue, build log, or release asset.
2. Create GitHub environments named `release` and `updater-test`. Protect `release`
   with required reviewers and restrict it to trusted release branches/tags. The
   workflow is manual, creates drafts, and needs Actions permission to write releases.
3. In **each environment**, configure:

   | Name | Kind | Value |
   | --- | --- | --- |
   | `TAURI_UPDATER_PUBLIC_KEY` | Variable | Full single-line contents of the `.pub` file |
   | `TAURI_SIGNING_PRIVATE_KEY` | Secret | Full private key file contents |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Secret | Key password |

   Generate a **different disposable pair** for `updater-test`. Both test builds use
   that same pair. Never use the local test key or test environment key for production.
4. The preparation script generates an ignored config overlay containing only public
   configuration. The base config deliberately contains no invented public key.
   Windows release compilation fails without a public key overlay; signed bundling
   fails without the corresponding private key. Normal Android builds need neither.
5. Preserve the production key across all future releases. Changing the variable to
   an unrelated key breaks existing installations' trust. Plan a signed transition
   release using the old key before rotating it; losing it requires manual migration.

Updater signatures are separate from **Windows Authenticode**. Configure your Windows
code-signing certificate/provider in Tauri if you use it for installer publisher trust
and SmartScreen; this workflow does not invent or provision a certificate. APK signing
also uses a different key and must retain the existing Android keystore.

## Stable release procedure (including 0.6)

1. Make the intended production version change separately when ready for 0.6. Keep
   `package.json`, `src-tauri/Cargo.toml`/lockfile, and `tauri.conf.json` consistent.
2. Run **Signed Windows release**, channel `stable`, on the reviewed release commit.
   The action builds Windows x64 NSIS plus `.sig` and `latest.json`, in a **draft**
   `v<version>` release. Review the commit/tag and draft before publishing.
3. Check that `latest.json` contains the intended version, a `windows-x86_64` entry,
   an HTTPS URL to that release's installer, and the **contents** of its `.sig`.
   Download and test the installer. Never modify a signed installer afterward.
   If replacing an artifact, replace its signature and manifest together before publish.
4. Add the Android APK built with the existing release signing process to the same
   release. Keep application ID `ryokan.desktop`, the same signing certificate, and
   a strictly increasing Android `versionCode`. Do not create a later Android-only
   stable release without the Windows updater manifest: it would break the latest feed.
5. Publish as a stable release and mark it **Latest**. Test the public manifest URL
   without authentication. Drafts are not publicly downloadable. Keep old release
   installers available for manual recovery. Do not mark updater-test releases Latest.

Local signed production build (PowerShell; key remains outside the repo):

```powershell
$env:TAURI_UPDATER_PUBLIC_KEY = (Get-Content -Raw C:\secure\ryokan-updater.key.pub).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY = 'C:\secure\ryokan-updater.key'
# Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD securely in this process if the key is encrypted.
node scripts/updater-config.mjs stable
npm run tauri -- build --config src-tauri/updater.generated.json -- --locked
```

The Windows platform config enables signed NSIS artifacts without imposing signing on
Android. Do not pass `updater.generated.json` to an Android build. A plain unsigned
Windows release build is intentionally rejected; debug development still works, though
updating with the empty development public key cannot pass verification.

## Full end-to-end test before 0.6

The workflow's `test` channel builds **0.5.1 → 0.5.2** from the same reviewed source.
Versions are overridden only in an ignored config overlay, never written to production
manifests. Both have product name **Ryokan Updater Test**, identifier
`ryokan.updater-test`, and a fixed HTTPS feed pointing to the test target release:
`https://github.com/Finn-Hecker/RyokanApp/releases/download/updater-test-v0.5.2/latest.json`.
This separates the installer identity and the identifier-based local SQLite directory
from production. Use a disposable Windows VM/snapshot anyway to test installer failures.
These are numeric stable *app* versions because the updater intentionally excludes
SemVer prereleases; their **GitHub releases must stay marked prerelease**.

1. Configure the `updater-test` environment with its own key pair. Run the workflow
   with channel `test`. It creates two draft prereleases and their signed assets.
2. Publish `updater-test-v0.5.2` as a **prerelease**, never Latest. Confirm its manifest
   and artifact are public. Download the 0.5.1 installer from its draft (as maintainer),
   or publish that release as a prerelease too. Do not use the old production 0.5.0 binary.
3. In the VM install **Ryokan Updater Test 0.5.1** through NSIS and launch it from its
   installed shortcut (not `tauri dev` or an unpackaged executable). Complete onboarding,
   create disposable sample data, and confirm Settings reports installed version 0.5.1.
4. Confirm the startup notice and manual check find 0.5.2. Click Download. Observe
   progress (indeterminate is valid without Content-Length), then the verified state.
   Confirm leaving/reopening Settings retains that state and nothing installs yet.
5. Click Install and restart. Confirm the old process exits, NSIS runs, the installed
   app relaunches, Settings reports **0.5.2**, and disposable data still exists.
   Check again: no newer update. Restart once more and verify the reported version.
6. Restore the VM snapshot and repeat failure cases below. Record pass/fail, versions,
   workflow run/commit, manifest, and installer SHA-256 hashes in your release checklist.

| Failure case (test feed / VM only) | Expected result |
| --- | --- |
| Offline or blocked GitHub during check | App stays usable; retryable check error |
| Target release still draft, missing manifest, or malformed JSON | Check error, never a false success |
| Equal or older manifest version | No update offered (no forced downgrade) |
| SemVer prerelease in manifest | Not offered |
| Missing artifact or interrupted download | Download error; no installation |
| Wrong `.sig`, different test signing key, or modified installer bytes | Verification fails; no Install button and no installer launched |
| Manifest claims a higher version but serves an older signed installer | Signed version mismatch; no installation |
| Installer cannot launch / security software blocks it | Retryable launch error if returned by Tauri |
| Installer fails after app exits / insufficient disk space | Installer handles failure; reopen and verify version; manual recovery if needed |
| Close Settings during download; repeated button clicks | One operation; state retained, no duplicate install |

For corruption tests, alter only a copy of the **test** manifest or installer on the
test prerelease and restore valid assets afterward. Do not bypass TLS or signature
verification. Never overwrite production assets. Re-running a draft workflow can
replace assets; use a fresh test tag pair for repeated published tests by changing
the test matrix and its target version together. Do not rebuild an already published
stable tag in place.

To build the same test pair locally, use a disposable key and run sequentially:

```powershell
node scripts/updater-config.mjs test 0.5.1 0.5.2
npm run tauri -- build --config src-tauri/updater.generated.json -- --locked
# Save the generated 0.5.1 NSIS installer before the next build.
node scripts/updater-config.mjs test 0.5.2 0.5.2
npm run tauri -- build --config src-tauri/updater.generated.json -- --locked
```

Set the same signing environment variables as above, pointing to the disposable pair.
The workflow is the easiest way to produce the matching `latest.json`; Tauri CLI alone
produces the installer and signature, not the hosted manifest. If creating it manually,
follow the official manifest schema and use the complete signature file contents.
If signing manually, use `tauri signer sign --app-version <version>`; `tauri build`
records the version automatically. Old signatures without a version are rejected.

## Android support boundary

Tauri's updater does **not** support Android. Ryokan therefore shows its installed
version and **Open latest release** on Android, with instructions to install the APK
through Android's package installer. There is no fake automatic check/download/install
or silent APK replacement. Retain the installed app and original APK signing key to
preserve data. Android requires user approval for sideloaded updates.

If Ryokan is distributed through Google Play later, use Play-managed updates or the
official Play In-App Updates API with native Android integration. Play's API is not
an updater for GitHub-sideloaded APKs; it is outside this small Windows updater change.

## Checks

`npm run test:updater` covers platform gating, resource ownership, serialization,
retry paths, verification-before-install, initialization, and test config isolation.
It mocks the native plugin and **does not prove native installation or restart**.
Run frontend checks/build, all existing JavaScript tests, Rust tests, the signed Windows
build, and Android build before release. The VM checklist above is the final native
acceptance test; a successful compilation is not a substitute.

Validation performed on 2026-09-24:

- Svelte/TypeScript: zero errors and warnings; production frontend build passed.
- JavaScript: 78 tests passed, including 11 updater/configuration tests.
- Rust: 63 library tests passed; Windows compile check passed.
- Signed NSIS test installers 0.5.1 and 0.5.2 built successfully with CLI 2.11.5.
  Both signatures were verified using the same minisign verification crate as Tauri;
  both contained their expected signed versions, and modified bytes were rejected.
- Final Windows executable metadata reports Ryokan Updater Test, version 0.5.2.
- Android arm64 debug APK built successfully; release APK signing was not exercised.
- Missing-key Windows release build was rejected; actionlint and diff checks passed.
- Existing frontend chunk-size/import warnings and Android Gradle deprecation warnings remain.
- **Not executed:** GitHub workflow on a configured environment, hosted update detection,
  installed-app download/install/restart, or Android device upgrade. Complete the VM
  acceptance steps above before publishing 0.6. No releases were published or apps installed.

Official references: [Tauri updater](https://v2.tauri.app/plugin/updater/),
[Tauri GitHub release pipeline](https://v2.tauri.app/distribute/pipelines/github/),
[tauri-action](https://github.com/tauri-apps/tauri-action),
[Android Play In-App Updates](https://developer.android.com/guide/playcore/in-app-updates).
