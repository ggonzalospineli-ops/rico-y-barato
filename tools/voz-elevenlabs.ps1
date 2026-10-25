$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$secure = Read-Host 'Pegá tu API key de ElevenLabs' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:ELEVENLABS_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
$voice = Read-Host 'Voice ID argentina (Enter para elegirla desde Mila)'
if ($voice) { $env:ELEVENLABS_VOICE_ID = $voice }
Write-Host 'Abriendo Rico y Barato con ElevenLabs...'
Set-Location $repo
node server.mjs
