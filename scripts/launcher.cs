using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Launcher {
    [STAThread]
    private static void Main() {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string script = Path.Combine(root, "scripts", "app.ps1");
            if (!File.Exists(script)) throw new IOException("Extract the complete DWB folder before opening the app.");
            var start = new ProcessStartInfo {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + script + "\"",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            // Windows PowerShell must use its own module paths when launched from PS7.
            start.EnvironmentVariables.Remove("PSModulePath");
            Process.Start(start);
        } catch (Exception error) {
            MessageBox.Show(error.Message, "DWB MCP Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
