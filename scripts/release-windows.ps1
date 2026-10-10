param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')]
    [string]$Version,
    [string]$Repo = 'Finn-Hecker/RyokanApp',
    [string]$PrivateKeyPath = 'C:\secure\ryokan-updater.key',
    [string]$PublicKeyPath = 'C:\secure\ryokan-updater.key.pub',
    [string]$ApkPath,
    [string]$InstallerPath,
    [switch]$UploadOnly,
    [switch]$SkipAndroidBuild,
    [switch]$SkipNpmCi,
    [switch]$AllowDirty,
    [switch]$UpdateExistingDraft
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Native {
    param([Parameter(Mandatory = $true)][string]$Command, [string[]]$Arguments = @())
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}
function Invoke-GitHub {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    # PS 5.1 can turn native stderr into a terminating NativeCommandError even
    # with 2>&1. Read both process streams directly; only the exit code decides
    # success. Drain them concurrently to avoid pipe-buffer deadlocks.
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = (Get-Command gh -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
    # ProcessStartInfo.ArgumentList is unavailable on .NET Framework / PS 5.1.
    # Windows argv quoting doubles backslashes before quotes and the closing quote.
    $startInfo.Arguments = (($Arguments | ForEach-Object {
        '"' + [regex]::Replace([regex]::Replace($_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
    }) -join ' ')
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $output = $stdout.GetAwaiter().GetResult()
        $errorOutput = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) {
            throw "gh $($Arguments[0]) failed with exit code $($process.ExitCode): $($errorOutput.Trim()) $($output.Trim())"
        }
        if ($errorOutput.Trim()) { Write-Host $errorOutput.Trim() }
        return $output
    } finally { $process.Dispose() }
}
function Get-GitHubRelease {
    param([Parameter(Mandatory = $true)][string]$Repo, [Parameter(Mandatory = $true)][string]$Tag)
    # A 404 on a tag endpoint can also hide an inaccessible repository. Instead,
    # absence means a SUCCESSFUL complete list (including drafts) has no match.
    # @json emits one compact JSON record per line, including across pages.
    $json = Invoke-GitHub @('api', "repos/$Repo/releases?per_page=100", '--paginate', '--jq', '.[] | {id, tag_name, draft} | @json')
    $matches = @()
    foreach ($line in ($json -split '\r?\n')) {
        if (-not $line.Trim()) { continue }
        $release = $line | ConvertFrom-Json -ErrorAction Stop
        if ($release.id -le 0 -or $release.tag_name -isnot [string] -or $release.draft -isnot [bool]) {
            throw 'GitHub returned invalid release metadata.'
        }
        if ($release.tag_name -ceq $Tag) { $matches += $release }
    }
    if ($matches.Count -gt 1) { throw "GitHub returned multiple releases for $Tag." }
    if ($matches.Count -eq 1) { return $matches[0] }
    return $null
}
function Assert-ReleaseCanUpdate {
    param($Release, [Parameter(Mandatory = $true)][string]$Tag, [switch]$UpdateExistingDraft)
    if ($null -eq $Release) { return }
    if (-not $Release.draft) { throw "Release $Tag is already published. Refusing to replace signed assets." }
    if (-not $UpdateExistingDraft) {
        throw "Draft release $Tag already exists. Re-run with -UpdateExistingDraft only if you intentionally want to replace its draft assets."
    }
}
function Get-GitHubReleaseById {
    param([string]$Repo, [long]$Id, [string]$Tag)
    $json = Invoke-GitHub @('api', "repos/$Repo/releases/$Id", '--jq', '{id, tag_name, draft}')
    return ConvertFrom-GitHubRelease -Json $json -Tag $Tag -Id $Id
}
function ConvertFrom-GitHubRelease {
    param([string]$Json, [string]$Tag, [long]$Id = 0)
    $release = $Json | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $release -or $release.id -le 0 -or $release.tag_name -cne $Tag -or
        $release.draft -isnot [bool] -or ($Id -gt 0 -and $release.id -ne $Id)) {
        throw "GitHub returned invalid release metadata for $Tag. Refusing to upload assets."
    }
    return $release
}
function Get-ExistingReleaseAssets {
    param([string]$InstallerPath, [string]$Version, [string]$Repo, [string]$ApkPath)
    if (-not $InstallerPath -or -not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
        throw '-UploadOnly requires -InstallerPath pointing to an existing signed installer.'
    }
    $installer = Get-Item -LiteralPath $InstallerPath
    if ($installer.Extension -ine '.exe' -or $installer.VersionInfo.ProductVersion -ne $Version) {
        throw "Installer product version must be ${Version}: $InstallerPath"
    }
    $signaturePath = "$($installer.FullName).sig"
    $manifestPath = Join-Path $installer.DirectoryName 'latest.json'
    if (-not (Test-Path -LiteralPath $signaturePath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw '-UploadOnly requires the existing installer .sig and latest.json from the completed build.'
    }
    $signature = (Get-Content -LiteralPath $signaturePath -Raw).Trim()
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $platform = $manifest.platforms.'windows-x86_64'
    $url = "https://github.com/$Repo/releases/download/v$Version/$([Uri]::EscapeDataString($installer.Name))"
    if (-not $signature -or $manifest.version -ne $Version -or $platform.signature -cne $signature -or $platform.url -cne $url) {
        throw 'Existing latest.json does not match the requested version, repository, installer and signature.'
    }
    if ($ApkPath) {
        if (-not (Test-Path -LiteralPath $ApkPath -PathType Leaf) -or
            [IO.Path]::GetExtension($ApkPath) -ine '.apk' -or (Split-Path -Leaf $ApkPath) -match 'unsigned|debug') {
            throw '-UploadOnly requires an existing Android release APK when -ApkPath is specified.'
        }
        Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
        $apk = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ApkPath).Path)
        try {
            $abis = @($apk.Entries | Where-Object { $_.FullName -match '^lib/[^/]+/[^/]+\.so$' } |
                ForEach-Object { ($_.FullName -split '/')[1] } | Select-Object -Unique)
            if ($abis.Count -ne 1 -or $abis[0] -cne 'arm64-v8a') {
                throw '-UploadOnly requires an ARM64-only APK.'
            }
        } finally { $apk.Dispose() }
    }
    return [pscustomobject]@{ Installer = $installer; SignaturePath = $signaturePath; ManifestPath = $manifestPath }
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
    if ($status -and -not $AllowDirty) {
        throw 'Working tree is not clean. Commit/clean changes or pass -AllowDirty to build the local working tree without committing.'
    }
    if ($status) {
        Write-Warning 'Building uncommitted changes. The GitHub release target refers to HEAD; its source archives will not include these local changes.'
    }
    [void](Invoke-GitHub @('auth', 'status'))
    $permission = (Invoke-GitHub @('repo', 'view', $Repo, '--json', 'viewerPermission', '--jq', '.viewerPermission')).Trim()
    if ($permission -notin @('ADMIN', 'MAINTAIN', 'WRITE')) {
        throw "GitHub write permission is required for $Repo (viewerPermission: $permission)."
    }
    $head = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve HEAD.' }
    $remoteHead = (Invoke-GitHub @('api', "repos/$Repo/commits/$head", '--jq', '.sha')).Trim()
    if ($remoteHead -ne $head) {
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
    if ($InstallerPath -and -not $UploadOnly) { throw 'Use -UploadOnly together with -InstallerPath.' }
    if ($ApkPath -and -not $SkipAndroidBuild -and -not $UploadOnly) {
        throw 'Use -SkipAndroidBuild together with -ApkPath to upload an existing APK.'
    }
    if ($ApkPath -and -not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) {
        throw "Android APK not found: $ApkPath"
    }
    if ($ApkPath -and -not $ApkPath.EndsWith('.apk', [StringComparison]::OrdinalIgnoreCase)) {
        throw "ApkPath must point to an .apk file: $ApkPath"
    }
    Write-Host 'Version files are consistent.' -ForegroundColor Green

    # Fail before dependency installation, signing prompts or expensive builds.
    $tag = "v$Version"
    $initialRelease = Get-GitHubRelease -Repo $Repo -Tag $tag
    Assert-ReleaseCanUpdate -Release $initialRelease -Tag $tag -UpdateExistingDraft:$UpdateExistingDraft

    if ($UploadOnly) {
        $existingAssets = Get-ExistingReleaseAssets -InstallerPath $InstallerPath -Version $Version -Repo $Repo -ApkPath $ApkPath
        $installer = $existingAssets.Installer
        $signaturePath = $existingAssets.SignaturePath
        $manifestPath = $existingAssets.ManifestPath
        $builtApk = $null
        Write-Host 'Using explicitly selected existing release assets. No builds or signing password are needed.' -ForegroundColor Cyan
    } else {
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
        if ($postCheckStatus -and -not $AllowDirty) { throw 'Release checks changed tracked or untracked files. Review and commit/clean them before releasing, or use -AllowDirty.' }

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
    }

    # Upload order is deterministic, although GitHub controls display sorting.
    $apkFile = $null
    if ($builtApk) { $apkFile = $builtApk }
    elseif ($ApkPath) {
        $resolvedApk = Resolve-Path -LiteralPath $ApkPath -ErrorAction Stop
        $apkFile = Get-Item -LiteralPath $resolvedApk.Path
    }
    if ($apkFile -and ($apkFile.Name -eq $installer.Name -or $apkFile.Name -eq 'latest.json' -or $apkFile.Name -eq (Split-Path -Leaf $signaturePath))) {
        throw "APK asset name conflicts with another release asset: $($apkFile.Name)"
    }
    $orderedAssets = @($installer.FullName)
    if ($null -ne $apkFile) { $orderedAssets += $apkFile.FullName }
    $orderedAssets += $signaturePath
    $orderedAssets += $manifestPath

    # The release may have changed while building. Do not adopt a new/replaced
    # draft or overwrite a release that someone has since published.
    $existingRelease = Get-GitHubRelease -Repo $Repo -Tag $tag
    Assert-ReleaseCanUpdate -Release $existingRelease -Tag $tag -UpdateExistingDraft:$UpdateExistingDraft
    if (($null -eq $initialRelease) -ne ($null -eq $existingRelease) -or
        ($null -ne $initialRelease -and $initialRelease.id -ne $existingRelease.id)) {
        throw "Release $tag changed while building. Review it before retrying."
    }
    $clobber = $null -ne $existingRelease
    if ($clobber) {
        Write-Host "Updating existing draft $tag..." -ForegroundColor Yellow
    } else {
        Write-Host "Creating GitHub draft release $tag..." -ForegroundColor Cyan
        # The creation response identifies the exact release. The list endpoint
        # can lag behind creation; never rediscover a new draft through that list.
        $createdJson = Invoke-GitHub @('api', "repos/$Repo/releases", '--method', 'POST',
            '--raw-field', "tag_name=$tag", '--raw-field', "target_commitish=$head",
            '--raw-field', "name=Ryokan $tag", '--raw-field', 'body=Windows and Android release. Review and test assets before publishing.',
            '--field', 'draft=true', '--jq', '{id, tag_name, draft}')
        $existingRelease = ConvertFrom-GitHubRelease -Json $createdJson -Tag $tag
        if (-not $existingRelease.draft) { throw "GitHub did not return a draft for $tag. Refusing to upload assets." }
    }
    foreach ($asset in $orderedAssets) {
        $currentRelease = Get-GitHubReleaseById -Repo $Repo -Id $existingRelease.id -Tag $tag
        if ($null -eq $currentRelease -or -not $currentRelease.draft -or $currentRelease.id -ne $existingRelease.id) {
            throw "Draft release $tag changed before upload. Refusing to replace assets."
        }
        Write-Host "Uploading $(Split-Path -Leaf $asset)..." -ForegroundColor Cyan
        $uploadArgs = @('release', 'upload', $tag, $asset, '--repo', $Repo)
        if ($clobber) { $uploadArgs += '--clobber' }
        [void](Invoke-GitHub $uploadArgs)
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
