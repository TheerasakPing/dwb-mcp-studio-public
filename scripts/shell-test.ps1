$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'setup-common.ps1')
$root=Split-Path -Parent $PSScriptRoot
$testRoot=Join-Path $root ('logs\shell-'+[Guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $testRoot -Force
$env:DWB_DATA_DIR=Join-Path $testRoot 'data'
$env:DWB_CONFIG_FILE=Join-Path $env:DWB_DATA_DIR 'config.json'
foreach($mode in @('TestReport','UiTestReport','Startup')){
  $report=Join-Path $testRoot ($mode+'.txt')
  $testSwitch=if($mode -eq 'Startup'){'UiTestReport'}else{$mode}
  $extra=if($mode -eq 'Startup'){' -Startup'}else{''}
  $arguments='-NoProfile -STA -ExecutionPolicy Bypass -File '+(ConvertTo-DwbArgument (Join-Path $PSScriptRoot 'app.ps1'))+' -'+$testSwitch+' '+(ConvertTo-DwbArgument $report)+$extra
  $process=Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot ($mode+'.out')) -RedirectStandardError (Join-Path $testRoot ($mode+'.err'))
  $null=$process.Handle
  if(-not $process.WaitForExit(60000)){
    $null=Start-Process taskkill.exe -ArgumentList @('/PID',[string]$process.Id,'/T','/F') -WindowStyle Hidden -Wait
    throw ('Shell test timeout: '+$testRoot)
  }
  $process.Refresh()
  if($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $report)){throw ('Shell test failed: '+[IO.File]::ReadAllText((Join-Path $testRoot ($mode+'.err'))))}
  Write-Output ([IO.File]::ReadAllText($report))
}
if(Test-Path -LiteralPath (Join-Path $env:DWB_DATA_DIR 'tunnel\process.json')){throw 'UI tests unexpectedly launched a tunnel.'}
Write-Output 'SHELL_TEST_PASS'
