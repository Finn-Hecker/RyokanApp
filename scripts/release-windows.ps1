param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')]
    [string]$Version,
    [string]$Repo = 'Finn-Hecker/RyokanApp',
    [string]$PrivateKeyPath = 'C:\secure\ryokan-updater.key',
    [string]$PublicKeyPath = 'C:\secure\ryokan-updater.key.pub',
    [string]$ApkPath,
    [switch]$SkipAndroidBuild,
    [switch]$SkipNpmCi,
    [switch]$UpdateExistingDraft
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Native {
    param([Parameter(Mandatory = $true)][string]$Command, [string[]]$Arguments = @())
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}
function Require-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}
function Get-CargoPackageVersion {
    param([Parameter(Mandatory = $true)][string]$Path)
    $match = Select-String -Path $Path -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1
    if (-not $match) { throw "Could not read package version from $Path" }
    return $match.Matches[0].Groups[1].Value
}
function Test-EncodedUpdaterPublicKey {
    param([Parameter(Mandatory = $true)][string]$Value)
    try {
        $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value.Trim()))
        return $decoded.TrimStart().StartsWith('untrusted comment:')
    } catch { return $false }
}
function Convert-SecureStringToPlainText {
    param([Parameter(Mandatory = $true)][Security.SecureString]$SecureString)
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This release script is intended for Windows.'
}
foreach ($command in @('git', 'node', 'npm', 'npx', 'cargo', 'gh')) { Require-Command $command }

$root = $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'package.json'))) {
    $parent = Split-Path -Parent $root
    if (Test-Path (Join-Path $parent 'package.json')) { $root = $parent }
}
if (-not (Test-Path (Join-Path $root 'src-tauri\tauri.conf.json'))) {
    throw 'Could not locate the Ryokan repository root.'
}

Push-Location $root
$oldPublicKey = [Environment]::GetEnvironmentVariable('TAURI_UPDATER_PUBLIC_KEY', 'Process')
$oldPrivateKey = [Environment]::GetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY', 'Process')
$oldPrivateKeyPassword = [Environment]::GetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'Process')
try {
    Write-Host "== Ryokan Windows + Android ARM64 release v$Version ==" -ForegroundColor Cyan

    $status = (& git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw 'git status failed.' }
    if ($status) { throw 'Working tree is not clean. Commit or discard all changes before creating a signed release.' }
    Invoke-Native gh @('auth', 'status')
    $head = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve HEAD.' }
    $remoteHead = (& gh api "repos/$Repo/commits/$head" --jq '.sha' 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $remoteHead) {
        throw "HEAD $head is not available on GitHub. Push the release commit first."
    }

    $package = Get-Content -Raw 'package.json' | ConvertFrom-Json
    $lockVersions = @(& node -e "const p=JSON.parse(require('fs').readFileSync('package-lock.json','utf8')); console.log(p.version); console.log(p.packages[''].version)")
    if ($LASTEXITCODE -ne 0 -or $lockVersions.Count -lt 2) { throw 'Could not read versions from package-lock.json.' }
    $tauri = Get-Content -Raw 'src-tauri\tauri.conf.json' | ConvertFrom-Json
    $cargoVersion = Get-CargoPackageVersion 'src-tauri\Cargo.toml'
    $versions = [ordered]@{
        'package.json' = [string]$package.version
        'package-lock.json' = [string]$lockVersions[0]
        'package-lock root package' = [string]$lockVersions[1]
        'tauri.conf.json' = [string]$tauri.version
        'Cargo.toml' = [string]$cargoVersion
    }
    foreach ($entry in $versions.GetEnumerator()) {
        if ($entry.Value -ne $Version) {
            throw "Version mismatch: $($entry.Key) is $($entry.Value), expected $Version."
        }
    }
    if ($ApkPath -and -not $SkipAndroidBuild) {
        throw 'Use -SkipAndroidBuild together with -ApkPath to upload an existing APK.'
    }
    if ($ApkPath -and -not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) {
        throw "Android APK not found: $ApkPath"
    }
    Write-Host 'Version files are consistent.' -ForegroundColor Green

    & cargo metadata --locked --no-deps --format-version 1 --manifest-path 'src-tauri\Cargo.toml' *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Cargo.lock is not compatible with Cargo.toml.' }

    if (-not $env:TAURI_UPDATER_PUBLIC_KEY) {
        if (-not (Test-Path $PublicKeyPath)) {
            throw "Updater public key not found at '$PublicKeyPath'. Set TAURI_UPDATER_PUBLIC_KEY or pass -PublicKeyPath."
        }
        $publicKeyRaw = (Get-Content -Raw $PublicKeyPath).Trim()
        if ($publicKeyRaw.StartsWith('untrusted comment:')) {
            $env:TAURI_UPDATER_PUBLIC_KEY = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($publicKeyRaw))
        } elseif (Test-EncodedUpdaterPublicKey $publicKeyRaw) {
            $env:TAURI_UPDATER_PUBLIC_KEY = $publicKeyRaw
        } else { throw 'The updater public key has an unexpected format.' }
    }
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
        if (-not (Test-Path $PrivateKeyPath)) {
            throw "Updater private key not found at '$PrivateKeyPath'. Set TAURI_SIGNING_PRIVATE_KEY or pass -PrivateKeyPath."
        }
        $env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path $PrivateKeyPath).Path
    }
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
        $securePassword = Read-Host 'Signing key password (press Enter if the key has no password)' -AsSecureString
        $plainPassword = Convert-SecureStringToPlainText $securePassword
        if ($plainPassword.Length -gt 0) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $plainPassword }
        $plainPassword = $null
    }

    if (-not $SkipNpmCi) {
        Write-Host 'Installing locked npm dependencies...' -ForegroundColor Cyan
        Invoke-Native npm @('ci')
    }
    Write-Host 'Running frontend/updater checks...' -ForegroundColor Cyan
    Invoke-Native npx @('paraglide-js', 'compile', '--project', './project.inlang', '--outdir', './src/lib/paraglide')
    Invoke-Native npm @('run', 'check')
    Invoke-Native npm @('run', 'test:updater')
    $postCheckStatus = (& git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw 'git status failed after checks.' }
    if ($postCheckStatus) { throw 'Release checks changed tracked or untracked files. Review and commit/clean them before releasing.' }

    Write-Host 'Preparing signed updater configuration...' -ForegroundColor Cyan
    Invoke-Native node @('scripts/updater-config.mjs', 'stable')
    $targetBase = if ($env:CARGO_TARGET_DIR) {
        if ([IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)) { $env:CARGO_TARGET_DIR }
        else { Join-Path $root $env:CARGO_TARGET_DIR }
    } else { Join-Path $root 'src-tauri\target' }
    $nsisDir = Join-Path $targetBase 'x86_64-pc-windows-msvc\release\bundle\nsis'
    if (Test-Path $nsisDir) { Remove-Item -Recurse -Force $nsisDir }

    Write-Host 'Building signed Windows x64 NSIS installer...' -ForegroundColor Cyan
    Invoke-Native npm @('run', 'tauri', '--', 'build', '--target', 'x86_64-pc-windows-msvc', '--config', 'src-tauri/updater.generated.json', '--', '--locked')
    if (-not (Test-Path $nsisDir)) { throw "NSIS output directory was not created: $nsisDir" }
    $installers = @(Get-ChildItem -Path $nsisDir -Filter '*.exe' -File)
    if ($installers.Count -ne 1) { throw "Expected exactly one NSIS .exe in $nsisDir, found $($installers.Count)." }
    $installer = $installers[0]
    $signaturePath = "$($installer.FullName).sig"
    if (-not (Test-Path $signaturePath)) { throw "Updater signature not found: $signaturePath" }

    # Android is deliberately ARM64 only. It uses the configured Gradle keystore,
    # not the Windows updater signing key. Never run x86 or i686 builds here.
    $builtApk = $null
    if (-not $SkipAndroidBuild) {
        $androidOutputRoot = Join-Path $root 'src-tauri\gen\android\app\build\outputs\apk'
        # Clear only old APK release output folders so a stale APK cannot be uploaded.
        if (Test-Path $androidOutputRoot) {
            $releaseDirs = @(Get-ChildItem -LiteralPath $androidOutputRoot -Directory -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'release' })
            foreach ($releaseDir in $releaseDirs) { Remove-Item -LiteralPath $releaseDir.FullName -Recurse -Force }
        }
        Write-Host 'Building Android ARM64 release APK...' -ForegroundColor Cyan
        $androidPrivateKey = $env:TAURI_SIGNING_PRIVATE_KEY
        $androidPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
        Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
        try {
            Invoke-Native npm @('run', 'tauri', '--', 'android', 'build', '--apk', '--target', 'aarch64')
        } finally {
            if ($null -ne $androidPrivateKey) { $env:TAURI_SIGNING_PRIVATE_KEY = $androidPrivateKey }
            if ($null -ne $androidPassword) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $androidPassword }
        }
        $apks = @()
        if (Test-Path $androidOutputRoot) {
            $apks = @(Get-ChildItem -LiteralPath $androidOutputRoot -Filter '*.apk' -File -Recurse |
                Where-Object { $_.Directory.Name -eq 'release' })
        }
        if ($apks.Count -ne 1) {
            throw "Expected exactly one Android release APK under $androidOutputRoot, found $($apks.Count)."
        }
        $builtApk = $apks[0]
        if ($builtApk.Name -match 'unsigned') {
            throw 'Android release APK is unsigned. Configure Gradle release keystore signing before distributing.'
        }
        Write-Host "Android ARM64 APK: $($builtApk.FullName)" -ForegroundColor Green
    }

    $tag = "v$Version"
    $assetName = $installer.Name
    $escapedAssetName = [Uri]::EscapeDataString($assetName)
    $downloadUrl = "https://github.com/$Repo/releases/download/$tag/$escapedAssetName"
    $signature = (Get-Content -Raw $signaturePath).Trim()
    $manifest = [ordered]@{
        version = $Version
        notes = 'Signed Windows installer.'
        platforms = [ordered]@{
            'windows-x86_64' = [ordered]@{ signature = $signature; url = $downloadUrl }
        }
    }
    $manifestPath = Join-Path $nsisDir 'latest.json'
    $manifestJson = $manifest | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($manifestPath, $manifestJson + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
    Write-Host 'Generated latest.json:' -ForegroundColor Green
    Write-Host $manifestJson

    $existingReleaseJson = (& gh release view $tag --repo $Repo --json isDraft,tagName 2>$null)
    $releaseExists = $LASTEXITCODE -eq 0
    if ($releaseExists) {
        $existingRelease = $existingReleaseJson | ConvertFrom-Json
        if (-not $existingRelease.isDraft) { throw "Release $tag is already published. Refusing to replace signed assets." }
        if (-not $UpdateExistingDraft) {
            throw "Draft release $tag already exists. Re-run with -UpdateExistingDraft only if you intentionally want to replace its draft assets."
        }
        Write-Host "Updating existing draft $tag..." -ForegroundColor Yellow
    } else {
        Write-Host "Creating GitHub draft release $tag..." -ForegroundColor Cyan
        Invoke-Native gh @('release', 'create', $tag, '--repo', $Repo, '--draft', '--target', $head, '--title', "Ryokan $tag", '--notes', 'Windows and Android release. Review and test assets before publishing.')
    }

    # Upload order is deterministic, although GitHub controls display sorting.
    $apkFile = $null
    if ($builtApk) { $apkFile = $builtApk }
    elseif ($ApkPath) {
        $resolvedApk = Resolve-Path -LiteralPath $ApkPath -ErrorAction Stop
        $apkFile = Get-Item -LiteralPath $resolvedApk.Path
        if (-not $apkFile.Name.EndsWith('.apk', [StringComparison]::OrdinalIgnoreCase)) {
            throw "ApkPath must point to an .apk file: $ApkPath"
        }
    }
    if ($apkFile -and ($apkFile.Name -eq $installer.Name -or $apkFile.Name -eq 'latest.json' -or $apkFile.Name -eq (Split-Path -Leaf $signaturePath))) {
        throw "APK asset name conflicts with another release asset: $($apkFile.Name)"
    }
    $orderedAssets = @($installer.FullName)
    if ($null -ne $apkFile) { $orderedAssets += $apkFile.FullName }
    $orderedAssets += $signaturePath
    $orderedAssets += $manifestPath
    foreach ($asset in $orderedAssets) {
        Write-Host "Uploading $(Split-Path -Leaf $asset)..." -ForegroundColor Cyan
        Invoke-Native gh @('release', 'upload', $tag, $asset, '--repo', $Repo, '--clobber')
    }
    $hash = (Get-FileHash -Algorithm SHA256 $installer.FullName).Hash
    Write-Host ''
    Write-Host "Draft release ready: $tag" -ForegroundColor Green
    Write-Host "Installer: $($installer.Name)"
    Write-Host "SHA-256:  $hash"
    Write-Host ('Assets uploaded in order: ' + (($orderedAssets | ForEach-Object { Split-Path -Leaf $_ }) -join ', '))
    Write-Host 'Nothing was published automatically. Review/test the draft before publishing.' -ForegroundColor Yellow
} finally {
    Pop-Location
    if ($null -eq $oldPublicKey) { Remove-Item Env:\TAURI_UPDATER_PUBLIC_KEY -ErrorAction SilentlyContinue }
    else { $env:TAURI_UPDATER_PUBLIC_KEY = $oldPublicKey }
    if ($null -eq $oldPrivateKey) { Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue }
    else { $env:TAURI_SIGNING_PRIVATE_KEY = $oldPrivateKey }
    if ($null -eq $oldPrivateKeyPassword) { Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue }
    else { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $oldPrivateKeyPassword }
}
