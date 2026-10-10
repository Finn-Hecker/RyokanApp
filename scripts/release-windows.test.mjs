import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('release workflow handles native GitHub responses under Windows PowerShell 5.1', {
  skip: process.platform !== 'win32' ? 'Requires Windows PowerShell 5.1' : false,
  timeout: 120_000,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'ryokan-release-test-'));
  const harness = join(directory, 'test.ps1');
  const source = fileURLToPath(new URL('./release-windows.ps1', import.meta.url));
  writeFileSync(harness, String.raw`
param([string]$Source, [string]$Directory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5) { throw 'Tests must run in Windows PowerShell 5.1.' }
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Load actual production functions without executing builds, signing or GitHub.
foreach ($function in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($function.Extent.Text))
}
$text = [IO.File]::ReadAllText($Source)
$preflightStart = $text.IndexOf('    $tag = "v$Version"')
$preflightEnd = $text.IndexOf('    if ($UploadOnly)', $preflightStart)
$preflight = [scriptblock]::Create($text.Substring($preflightStart, $preflightEnd - $preflightStart))
$uploadStart = $text.IndexOf('    # The release may have changed while building.')
$uploadEnd = $text.IndexOf('    $hash =', $uploadStart)
$upload = [scriptblock]::Create($text.Substring($uploadStart, $uploadEnd - $uploadStart))
if ($preflightStart -ge $text.IndexOf('    if (-not $SkipNpmCi)')) { throw 'Release preflight must precede builds.' }

# A real native executable emits separate stdout/stderr and exit codes. No real
# gh command or network is used. Also records argv to test .NET Framework quoting.
$fakeSource = @'
using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
[assembly: System.Reflection.AssemblyInformationalVersion("0.7.0")]
public class FakeGitHub {
    public static int Main(string[] args) {
        string dir = Environment.GetEnvironmentVariable("RYOKAN_GH_TEST_DIR");
        var json = new JavaScriptSerializer();
        File.AppendAllText(Path.Combine(dir, "calls.jsonl"), json.Serialize(args) + "\n");
        string counter = Path.Combine(dir, "counter");
        int index = int.Parse(File.ReadAllText(counter));
        File.WriteAllText(counter, (index + 1).ToString());
        var responses = (object[])json.DeserializeObject(File.ReadAllText(Path.Combine(dir, "responses.json")));
        if (index >= responses.Length) { Console.Error.Write("Unexpected gh call"); return 99; }
        var response = (System.Collections.Generic.Dictionary<string, object>)responses[index];
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.Write((string)response["stdout"]);
        Console.Error.Write((string)response["stderr"]);
        return Convert.ToInt32(response["code"]);
    }
}
'@
Add-Type -TypeDefinition $fakeSource -ReferencedAssemblies 'System.Web.Extensions' -OutputAssembly (Join-Path $Directory 'gh.exe') -OutputType ConsoleApplication
$env:PATH = $Directory + ';' + $env:PATH
$env:RYOKAN_GH_TEST_DIR = $Directory
function Response {
    param([string]$Stdout = '', [string]$Stderr = '', [int]$Code = 0)
    return @{ stdout = $Stdout; stderr = $Stderr; code = $Code }
}
function Set-Responses {
    param([object[]]$Responses)
    [IO.File]::WriteAllText((Join-Path $Directory 'responses.json'), (ConvertTo-Json -InputObject $Responses -Depth 10))
    [IO.File]::WriteAllText((Join-Path $Directory 'counter'), '0')
    [IO.File]::WriteAllText((Join-Path $Directory 'calls.jsonl'), '')
}
function Calls {
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $Directory 'calls.jsonl'))) {
        ,($line | ConvertFrom-Json)
    }
}
function Assert {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function Throws {
    param([scriptblock]$Action, [string]$Pattern)
    $message = ''
    try { & $Action } catch { $message = $_.Exception.Message }
    Assert ($message -match $Pattern) "Expected '$Pattern', got '$message'"
}
$Version = '0.7.0'
$Repo = 'owner/repo'
$tag = 'v0.7.0'
$head = 'abc123'
$orderedAssets = @('C:\output with spaces\Ryokan.exe', 'C:\output\Ryokan.apk', 'C:\output\Ryokan.exe.sig', 'C:\output\latest.json')
$draft = '{"id":42,"tag_name":"v0.7.0","draft":true}'
$published = '{"id":42,"tag_name":"v0.7.0","draft":false}'
$other = '{"id":1,"tag_name":"v0.6.0","draft":false}'

# Authentication and write access must also fail before any builds/mutations.
$authStart = $text.IndexOf('    [void](Invoke-GitHub')
$authEnd = $text.IndexOf('    $head =', $authStart)
$auth = [scriptblock]::Create($text.Substring($authStart, $authEnd - $authStart))
Set-Responses @((Response '' 'authentication required' 4))
Throws { . $auth } 'authentication required'
Assert (@(Calls).Count -eq 1) 'Authentication failure continued to other commands'
foreach ($permissionResult in @('READ', 'TRIAGE', 'null', '')) {
    Set-Responses @((Response '' 'Logged in'), (Response $permissionResult))
    Throws { . $auth } 'write permission is required'
    Assert (@(Calls).Count -eq 2) 'Read-only access continued to builds'
}
Set-Responses @((Response), (Response '' 'repository access denied (HTTP 403)' 1))
Throws { . $auth } 'repository access denied'
foreach ($permissionResult in @('ADMIN', 'MAINTAIN', 'WRITE')) {
    Set-Responses @((Response), (Response $permissionResult))
    . $auth
}

# Original PS 5.1 failure mode: stderr with Stop, now preserved as useful failure.
Set-Responses @((Response '' 'release not found' 1))
Throws { Invoke-GitHub @('release', 'view', $tag) } 'exit code 1: release not found'
Assert ($ErrorActionPreference -eq 'Stop') 'ErrorActionPreference leaked'
# stderr on success must neither abort nor contaminate the JSON result.
Set-Responses @((Response $draft 'CLI warning'))
$release = Get-GitHubRelease $Repo $tag
Assert ($release.id -eq 42 -and $release.draft) 'Successful draft lookup failed'
$call = @(Calls)[0]
Assert ($call -contains '--paginate' -and $call[1] -eq 'repos/owner/repo/releases?per_page=100') 'Must list all release pages'

# Absence is successful enumeration, including unrelated releases and empty repos.
foreach ($output in @('', $other)) {
    Set-Responses @((Response $output))
    Assert ($null -eq (Get-GitHubRelease $Repo $tag)) 'Missing tag was not recognized'
}
Set-Responses @((Response ($other + [Environment]::NewLine + $draft)))
Assert ((Get-GitHubRelease $Repo $tag).id -eq 42) 'A matching release on a later page was missed'

foreach ($errorCase in @(
    @{ text = 'gh: Requires authentication (HTTP 401)'; code = 4 },
    @{ text = 'gh: Resource not accessible (HTTP 403)'; code = 1 },
    @{ text = 'gh: Not Found (HTTP 404)'; code = 1 },
    @{ text = 'dial tcp: network unavailable'; code = 1 },
    @{ text = 'gh: API rate limit exceeded (HTTP 403)'; code = 1 }
)) {
    Set-Responses @((Response '' $errorCase.text $errorCase.code))
    $UpdateExistingDraft = $false
    Throws { . $preflight } ([regex]::Escape($errorCase.text))
    Assert (@(Calls).Count -eq 1) 'Failed preflight attempted release mutation'
}
# Partial output followed by a pagination error must never count as success.
Set-Responses @((Response $draft 'page two failed (HTTP 500)' 1))
Throws { Get-GitHubRelease $Repo $tag } 'page two failed'
foreach ($invalid in @('not JSON', '{"id":42,"tag_name":"v0.7.0","draft":"false"}', ($draft + [Environment]::NewLine + $draft))) {
    Set-Responses @((Response $invalid))
    Throws { Get-GitHubRelease $Repo $tag } '.'
}

$UpdateExistingDraft = $false
Set-Responses @((Response $published))
Throws { . $preflight } 'already published'
Set-Responses @((Response $draft))
Throws { . $preflight } 'UpdateExistingDraft'

# Missing release -> draft creation at HEAD -> verified draft -> uploads in order.
Set-Responses @((Response ''), (Response ''), (Response $draft 'CLI notice'), (Response $draft), (Response), (Response $draft), (Response), (Response $draft), (Response), (Response $draft), (Response))
. $preflight
. $upload
$calls = @(Calls)
$create = $calls[2]
Assert ($create[0] -eq 'api' -and $create[1] -eq 'repos/owner/repo/releases' -and $create -contains 'POST' -and $create -contains 'draft=true' -and $create -contains "target_commitish=$head") 'Draft creation arguments incorrect'
Assert ($create -contains 'name=Ryokan v0.7.0' -and $create -contains 'body=Windows and Android release. Review and test assets before publishing.') 'Arguments with spaces were corrupted'
Assert (@($calls | Where-Object { $_ -contains '--paginate' }).Count -eq 2) 'Newly created draft must not depend on a refreshed list'
$uploads = @($calls | Where-Object { $_[0] -eq 'release' -and $_[1] -eq 'upload' })
Assert ($uploads.Count -eq 4) 'Missing assets'
for ($i = 0; $i -lt $uploads.Count; $i++) {
    Assert ($uploads[$i][3] -ceq $orderedAssets[$i]) 'Asset order/path incorrect'
    Assert ($uploads[$i] -notcontains '--clobber') 'New release must not clobber assets'
}
foreach ($call in ($calls | Where-Object { $_[0] -eq 'api' -and $_[1] -match '/releases/\d+$' })) {
    Assert ($call[1] -eq 'repos/owner/repo/releases/42') 'Uploads must verify the exact release ID returned by creation'
}

# Existing drafts can only clobber after explicit consent; never create them anew.
$UpdateExistingDraft = $true
Set-Responses @((Response $draft), (Response $draft), (Response $draft), (Response), (Response $draft), (Response), (Response $draft), (Response), (Response $draft), (Response))
. $preflight
. $upload
$calls = @(Calls)
$uploads = @($calls | Where-Object { $_[0] -eq 'release' -and $_[1] -eq 'upload' })
Assert ($uploads.Count -eq 4) 'Draft update uploads missing'
foreach ($call in $uploads) { Assert ($call -contains '--clobber') 'Draft update must clobber existing asset names' }
Assert (@($calls | Where-Object { $_[1] -eq 'create' }).Count -eq 0) 'Existing draft was recreated'

# Publication, deletion, replacement or appearance during builds fail closed.
foreach ($changed in @($published, '', '{"id":43,"tag_name":"v0.7.0","draft":true}')) {
    Set-Responses @((Response $draft), (Response $changed))
    . $preflight
    Throws { . $upload } 'published|changed while building'
    Assert (@(Calls).Count -eq 2) 'Changed release attempted mutation'
}
Set-Responses @((Response ''), (Response $draft))
. $preflight
Throws { . $upload } 'changed while building'

# Create errors and unverifiable drafts never proceed to upload.
$UpdateExistingDraft = $false
Set-Responses @((Response ''), (Response ''), (Response '' 'create denied (HTTP 403)' 1))
. $preflight
Throws { . $upload } 'create denied'
foreach ($afterCreate in @('', $published)) {
    Set-Responses @((Response ''), (Response ''), (Response $afterCreate))
    . $preflight
    Throws { . $upload } 'invalid release metadata|did not return a draft'
}
Set-Responses @((Response ''), (Response ''), (Response '{"id":42,"tag_name":"wrong-tag","draft":true}'))
. $preflight
Throws { . $upload } 'invalid release metadata'
# Stop immediately when an upload fails; do not upload the updater manifest.
$UpdateExistingDraft = $true
Set-Responses @((Response $draft), (Response $draft), (Response $draft), (Response '' 'upload failed' 1))
. $preflight
Throws { . $upload } 'upload failed'
Assert (@(Calls).Count -eq 4) 'Continued uploads after failure'
# Recheck state before every individual upload, not only at build completion.
Set-Responses @((Response $draft), (Response $draft), (Response $draft), (Response), (Response $published))
. $preflight
Throws { . $upload } 'changed before upload'
Assert (@(Calls).Count -eq 5) 'Published release received more uploads'
Set-Responses @((Response $draft), (Response $draft), (Response '{"id":43,"tag_name":"v0.7.0","draft":true}'))
. $preflight
Throws { . $upload } 'invalid release metadata'
Assert (@(Calls).Count -eq 3) 'ID mismatch received an upload'
Set-Responses @((Response $draft), (Response $draft), (Response '' 'release ID not accessible (HTTP 404)' 1))
. $preflight
Throws { . $upload } 'release ID not accessible'
Assert (@(Calls).Count -eq 3) 'Inaccessible draft received an upload'

# General native argv roundtrip, including embedded quotes and trailing slashes.
Set-Responses @((Response 'ok'))
$arguments = @('api', 'C:\path with spaces\', 'a"b', 'a\"b')
[void](Invoke-GitHub $arguments)
$actual = @(Calls)[0]
for ($i = 0; $i -lt $arguments.Count; $i++) { Assert ($actual[$i] -ceq $arguments[$i]) 'Windows argv quoting failed' }

# Exercise the actual dirty-tree gate without running any following commands.
$gateStart = $text.IndexOf('    if ($status -and -not $AllowDirty)')
$gateEnd = $text.IndexOf('    [void](Invoke-GitHub', $gateStart)
$gate = [scriptblock]::Create($text.Substring($gateStart, $gateEnd - $gateStart))
$status = ' M scripts/release-windows.ps1'
$AllowDirty = $false
Throws { . $gate } 'AllowDirty'
$AllowDirty = $true
. $gate
Assert ($ErrorActionPreference -eq 'Stop') 'Global error handling changed'

# Resume accepts explicit, consistent outputs and never enters the build branch.
$InstallerPath = Join-Path $Directory 'Ryokan_0.7.0_x64-setup.exe'
Copy-Item -LiteralPath (Join-Path $Directory 'gh.exe') -Destination $InstallerPath
$testSignaturePath = "$InstallerPath.sig"
$testManifestPath = Join-Path $Directory 'latest.json'
[IO.File]::WriteAllText($testSignaturePath, 'fixture signature')
$testManifest = @{
    version = $Version
    platforms = @{ 'windows-x86_64' = @{
        signature = 'fixture signature'
        url = 'https://github.com/owner/repo/releases/download/v0.7.0/Ryokan_0.7.0_x64-setup.exe'
    } }
}
[IO.File]::WriteAllText($testManifestPath, ($testManifest | ConvertTo-Json -Depth 6))
$ApkPath = Join-Path $Directory 'app-release.apk'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$testApk = [IO.Compression.ZipFile]::Open($ApkPath, [IO.Compression.ZipArchiveMode]::Create)
try { [void]$testApk.CreateEntry('lib/arm64-v8a/libryokan_lib.so') } finally { $testApk.Dispose() }
$assets = Get-ExistingReleaseAssets -InstallerPath $InstallerPath -Version $Version -Repo $Repo -ApkPath $ApkPath
Assert ($assets.Installer.FullName -ceq $InstallerPath) 'Resume selected a different installer'
Throws { Get-ExistingReleaseAssets -InstallerPath '' -Version $Version -Repo $Repo } 'requires -InstallerPath'
Throws { Get-ExistingReleaseAssets -InstallerPath $InstallerPath -Version '0.6.0' -Repo $Repo } 'product version'
Throws { Get-ExistingReleaseAssets -InstallerPath $InstallerPath -Version $Version -Repo 'wrong/repo' } 'does not match'
[IO.File]::WriteAllText($testSignaturePath, 'different signature')
Throws { Get-ExistingReleaseAssets -InstallerPath $InstallerPath -Version $Version -Repo $Repo } 'does not match'
[IO.File]::WriteAllText($testSignaturePath, 'fixture signature')
$testApk = [IO.Compression.ZipFile]::Open($ApkPath, [IO.Compression.ZipArchiveMode]::Update)
try { [void]$testApk.CreateEntry('lib/x86_64/libryokan_lib.so') } finally { $testApk.Dispose() }
Throws { Get-ExistingReleaseAssets -InstallerPath $InstallerPath -Version $Version -Repo $Repo -ApkPath $ApkPath } 'ARM64-only'
$ApkPath = $null
$UploadOnly = $true
function Invoke-Native { throw 'UploadOnly must not run build commands.' }
$buildGate = $ast.Find({ param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.StartsWith('if ($UploadOnly)') }, $true)
. ([scriptblock]::Create($buildGate.Extent.Text))
Assert ($installer.FullName -ceq $InstallerPath -and $null -eq $builtApk) 'UploadOnly build gate failed'
Remove-Item -LiteralPath $testSignaturePath
Throws { Get-ExistingReleaseAssets -InstallerPath $InstallerPath -Version $Version -Repo $Repo } 'existing installer .sig'
Write-Output 'PASS: PS 5.1 release simulations, native streams, argv and dirty-tree opt-in'
`, 'utf8');
  try {
    const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness, source, directory], {
      encoding: 'utf8', timeout: 110_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS: PS 5\.1 release simulations/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
