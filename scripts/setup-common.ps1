function Get-DwbDataDirectory {
  if ($env:DWB_DATA_DIR) { return [IO.Path]::GetFullPath($env:DWB_DATA_DIR) }
  return Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'DWB-MCP-Studio'
}

function Get-DwbConfigPath {
  if ($env:DWB_CONFIG_FILE) { return [IO.Path]::GetFullPath($env:DWB_CONFIG_FILE) }
  return Join-Path (Get-DwbDataDirectory) 'config.json'
}

function Get-DwbNode {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in @((Join-Path $env:ProgramFiles 'nodejs\node.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'))) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  return $null
}

function Get-DwbNpmCli([string]$NodePath) {
  if (-not $NodePath) { return $null }
  $roots = @((Split-Path -Parent $NodePath))
  $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($command) { $roots += Split-Path -Parent $command.Source }
  foreach ($root in $roots) {
    $candidate = Join-Path $root 'node_modules\npm\bin\npm-cli.js'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  return $null
}

function Test-DwbNodeVersion([string]$VersionText) {
  try { return ([version]($VersionText.Trim() -replace '^v','')) -ge [version]'22.16.0' }
  catch { return $false }
}

function Get-DwbMachineState {
  $node = Get-DwbNode
  $version = ''
  if ($node) { try { $version = ((& $node --version) | Out-String).Trim() } catch {} }
  $npm = Get-DwbNpmCli $node
  return [pscustomobject]@{ Node = $node; Version = $version; NodeReady = (Test-DwbNodeVersion $version); Npm = $npm; NpmReady = [bool]$npm }
}

function Get-DwbWorkerState([string]$Entry) {
  try {
    if (-not $Entry -or -not [IO.Path]::IsPathRooted($Entry) -or -not (Test-Path -LiteralPath $Entry -PathType Leaf)) { throw 'Choose the dist/index.js file from your Desktop Commander installation.' }
    $full = [IO.Path]::GetFullPath($Entry)
    $root = Split-Path -Parent (Split-Path -Parent $full)
    $package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($package.name -ne '@wonderwhy-er/desktop-commander' -or $package.version -ne '0.2.50') { throw 'This beta requires Desktop Commander MCP 0.2.50.' }
    if ($full -ne (Join-Path $root 'dist\index.js')) { throw 'Choose Desktop Commander dist/index.js.' }
    $source = Get-Content -LiteralPath (Join-Path $root 'dist\config.js') -Raw -Encoding UTF8
    if (-not $source.Contains('export const USER_HOME = os.homedir();') -and -not $source.Contains('export const USER_HOME = process.env.DWB_DC_CONFIG_HOME || os.homedir();')) { throw 'This Desktop Commander config layout is not supported.' }
    return [pscustomobject]@{ Ready = $true; Version = '0.2.50'; Message = 'Desktop Commander MCP 0.2.50'; Entry = $full }
  } catch { return [pscustomobject]@{ Ready = $false; Version = ''; Message = $_.Exception.Message; Entry = $Entry } }
}

function ConvertTo-DwbArgument([string]$Value) {
  # CommandLineToArgvW quoting; no cmd.exe or PowerShell expression evaluation.
  return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Invoke-DwbNode([string]$NodePath, [string[]]$Arguments, [string]$WorkingDirectory) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $NodePath
  $info.Arguments = (($Arguments | ForEach-Object { ConvertTo-DwbArgument $_ }) -join ' ')
  $info.WorkingDirectory = $WorkingDirectory
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  try {
    if (-not $process.Start()) { throw 'Could not start Node.js.' }
    $output = $process.StandardOutput.ReadToEndAsync()
    $errors = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $output.GetAwaiter().GetResult()
    $stderr = $errors.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "Command failed ($($process.ExitCode)).`n$stderr`n$stdout" }
    if ($stderr) { [Console]::Error.WriteLine($stderr) }
    return $stdout
  } finally { $process.Dispose() }
}
