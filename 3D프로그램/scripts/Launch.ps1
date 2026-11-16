$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
try {
  $runtime = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction SilentlyContinue
  if (-not $runtime -or $runtime.Installed -ne 1) {
    Write-Host 'Installing Microsoft Visual C++ Runtime (first run only)...'
    $installer = Join-Path $env:TEMP 'Sihu-VC-redist-x64.exe'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile $installer
    $signature = Get-AuthenticodeSignature -FilePath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
      Remove-Item $installer -Force
      throw 'Microsoft installer signature validation failed.'
    }
    $result = Start-Process -FilePath $installer -ArgumentList '/install','/passive','/norestart' -Wait -PassThru
    Remove-Item $installer -Force -ErrorAction SilentlyContinue
    if ($result.ExitCode -notin @(0,3010,1638)) { throw "Runtime installation failed: $($result.ExitCode)" }
    if ($result.ExitCode -eq 3010) { Write-Host 'Please restart Windows before opening the app.'; Read-Host 'Press Enter'; exit }
  }
  Start-Process -FilePath (Join-Path $root 'Sihu Emoji Studio.exe') -WorkingDirectory $root
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Install the Microsoft Visual C++ x64 Runtime from https://aka.ms/vs/17/release/vc_redist.x64.exe and try again.'
  Read-Host 'Press Enter'
  exit 1
}
