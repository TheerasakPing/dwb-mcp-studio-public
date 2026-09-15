param([string]$TestReport,[string]$UiTestReport)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Windows.Forms,System.Drawing
. (Join-Path $PSScriptRoot 'tunnel-common.ps1')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DwbWindowIdentity {
 [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern int SetCurrentProcessExplicitAppUserModelID(string id);
 [DllImport("shell32.dll")] public static extern int GetCurrentProcessExplicitAppUserModelID(out IntPtr id);
}
'@
$null=[DwbWindowIdentity]::SetCurrentProcessExplicitAppUserModelID('DevWithBebz.DwbMcpStudio')
$hash=[Security.Cryptography.SHA256]::Create()
try{$identity=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(($PSScriptRoot+'|'+(Get-DwbDataDirectory)).ToLowerInvariant())))).Replace('-','').Substring(0,24)}finally{$hash.Dispose()}
$wake=New-Object Threading.EventWaitHandle($false,[Threading.EventResetMode]::AutoReset,('Local\DWB-Studio-Wake-'+$identity))
$mutex=New-Object Threading.Mutex($false,('Local\DWB-Studio-UI-'+$identity))
$owned=$false
try{$owned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true}
if(-not $owned){$null=$wake.Set();$wake.Dispose();$mutex.Dispose();return}
$global:DwbShell=@{Window=$null;AllowClose=$false;Next='setup';Exiting=$false;Frame=$null}
$tray=New-Object Windows.Forms.NotifyIcon
$tray.Icon=New-Object Drawing.Icon((Join-Path $PSScriptRoot '..\assets\dwb.ico'),32,32)
$tray.Text='DWB MCP Studio';$tray.Visible=$true
function global:Restore-DwbWindow {
  $current=$global:DwbShell.Window
  if($current){$current.ShowInTaskbar=$true;$current.Show();$current.WindowState='Normal';$null=$current.Activate()}
}
function global:Set-DwbPage([string]$Page){
  $global:DwbShell.Next=$Page;$global:DwbShell.AllowClose=$true
  if($global:DwbShell.Window){$global:DwbShell.Window.Close()}
}
function global:Hide-DwbWindow {
  $current=$global:DwbShell.Window
  if($current){$current.Hide();$current.ShowInTaskbar=$false}
}
function global:Register-DwbWindow($Window){
  $global:DwbShell.Window=$Window;$global:DwbShell.AllowClose=$false
  $Window.Add_Closing({param($sender,$eventArgs)
    if(-not $global:DwbShell.AllowClose){$eventArgs.Cancel=$true;Hide-DwbWindow}
  })
  $Window.Add_StateChanged({if($global:DwbShell.Window.WindowState -eq 'Minimized'){Hide-DwbWindow}})
}
function global:Show-DwbWindow($Window){
  $frame=New-Object Windows.Threading.DispatcherFrame
  $global:DwbShell.Frame=$frame
  $Window.Add_Closed({$global:DwbShell.Frame.Continue=$false})
  $Window.Show()
  [Windows.Threading.Dispatcher]::PushFrame($frame)
}
$menu=New-Object Windows.Forms.ContextMenuStrip
$open=$menu.Items.Add('เปิด DWB MCP Studio');$open.Add_Click({Restore-DwbWindow})
$null=$menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
$quit=$menu.Items.Add('ออกจากหน้าควบคุม (MCP ยังทำงาน)')
$quit.Add_Click({$global:DwbShell.Exiting=$true;Set-DwbPage ''})
$tray.ContextMenuStrip=$menu
$tray.Add_MouseClick({param($sender,$eventArgs) if($eventArgs.Button -eq [Windows.Forms.MouseButtons]::Left){Restore-DwbWindow}})
$timer=New-Object Windows.Threading.DispatcherTimer
$timer.Interval=[TimeSpan]::FromMilliseconds(250)
$timer.Add_Tick({if($wake.WaitOne(0)){Restore-DwbWindow}})
$uiTimer=$null
if($UiTestReport){
  $global:DwbShell.Next='dashboard'
  $global:DwbShell.UiStep=0
  $global:DwbShell.UiFailure=$null
  $uiTimer=New-Object Windows.Threading.DispatcherTimer
  $uiTimer.Interval=[TimeSpan]::FromSeconds(1)
  $uiTimer.Add_Tick({
    try {
      $current=$global:DwbShell.Window
      if(-not $current){return}
      [IO.File]::AppendAllText($UiTestReport+'.progress',[string]$global:DwbShell.UiStep+' '+$current.Title+[Environment]::NewLine)
      switch($global:DwbShell.UiStep){
        0 {if(-not $current.FindName('Connection')){throw 'Dashboard missing'};$global:DwbShell.UiStep++;$current.FindName('Connection').RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))}
        1 {if(-not $current.FindName('ApiKey')){throw 'Connection page missing'};$current.Close();if($current.IsVisible){throw 'Connection close did not hide'};Restore-DwbWindow;$global:DwbShell.UiStep++;$current.FindName('Dashboard').RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))}
        2 {$global:DwbShell.UiStep++;$current.FindName('MachineSetup').RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))}
        3 {if(-not $current.FindName('WorkspaceInput')){throw 'Setup page missing'};$current.WindowState='Minimized';if($current.IsVisible){throw 'Setup minimize did not hide'};Restore-DwbWindow;$global:DwbShell.UiStep++;$current.FindName('DashboardHome').RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))}
        4 {if(-not $current.FindName('Connection')){throw 'Return to dashboard failed'};$current.Close();if($current.IsVisible){throw 'Dashboard close did not hide'};Restore-DwbWindow;$global:DwbShell.UiStep++;$global:DwbShell.Exiting=$true;Set-DwbPage ''}
      }
    }catch{$global:DwbShell.UiFailure=$_.Exception.ToString();$global:DwbShell.Exiting=$true;Set-DwbPage ''}
  })
  $uiTimer.Start()
}
try {
  $timer.Start()
  if($TestReport){
    $testWindow=New-Object Windows.Window
    $testWindow.Width=300;$testWindow.Height=160;$testWindow.Title='DWB shell test'
    $testWindow.Left=-20000;$testWindow.Top=-20000;$testWindow.WindowStartupLocation='Manual'
    Register-DwbWindow $testWindow
    $testWindow.Show()
    $testWindow.Close()
    if($testWindow.IsVisible -or -not $tray.Visible){throw 'Close did not hide to tray.'}
    Restore-DwbWindow
    if(-not $testWindow.IsVisible){throw 'Tray restore failed.'}
    $testWindow.WindowState='Minimized'
    if($testWindow.IsVisible){throw 'Minimize did not hide to tray.'}
    $second=Start-Process -FilePath (Join-Path $PSScriptRoot '..\DWB MCP Studio.exe') -WindowStyle Hidden -PassThru
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    while((-not $second.HasExited -or -not $testWindow.IsVisible) -and [DateTime]::UtcNow -lt $deadline){$testWindow.Dispatcher.Invoke([Action]{},[Windows.Threading.DispatcherPriority]::Background);Start-Sleep -Milliseconds 50}
    if(-not $second.HasExited -or -not $testWindow.IsVisible){throw 'Second launch did not restore the existing window.'}
    $pointer=[IntPtr]::Zero;$null=[DwbWindowIdentity]::GetCurrentProcessExplicitAppUserModelID([ref]$pointer)
    try{if([Runtime.InteropServices.Marshal]::PtrToStringUni($pointer) -ne 'DevWithBebz.DwbMcpStudio'){throw 'Taskbar identity was not set.'}}finally{[Runtime.InteropServices.Marshal]::FreeCoTaskMem($pointer)}
    Set-DwbPage 'dashboard'
    if($testWindow.IsVisible -or $global:DwbShell.Next -ne 'dashboard'){throw 'Page transition failed.'}
    [IO.File]::WriteAllText($TestReport,'PASS: close/minimize to tray, restore, second launch, taskbar identity, page transition.')
  }else{
    while(-not $global:DwbShell.Exiting -and $global:DwbShell.Next){
      $page=$global:DwbShell.Next;$global:DwbShell.Next=$null
      switch($page){
        'setup'{& (Join-Path $PSScriptRoot 'setup.ps1')}
        'setup-config'{& (Join-Path $PSScriptRoot 'setup.ps1') -ConfigureOnly}
        'dashboard'{& (Join-Path $PSScriptRoot 'dashboard.ps1')}
        'connection'{& (Join-Path $PSScriptRoot 'tunnel-setup.ps1')}
      }
    }
  }
  if($UiTestReport){if($global:DwbShell.UiFailure){throw $global:DwbShell.UiFailure};[IO.File]::WriteAllText($UiTestReport,'PASS: real Dashboard / Connection / Setup navigation, hide and restore, one shell process.')}
}catch{if($TestReport -or $UiTestReport){throw};[Windows.MessageBox]::Show($_.Exception.Message,'DWB MCP Studio')|Out-Null}
finally{
  if($uiTimer){$uiTimer.Stop()};$timer.Stop();$tray.Visible=$false;$tray.Icon.Dispose();$tray.Dispose();$menu.Dispose()
  $global:DwbShell=$null;$wake.Dispose();$mutex.ReleaseMutex();$mutex.Dispose()
}
