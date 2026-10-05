using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class ReportFlowLauncher
{
    private const int Port = 3000;
    private const string AppUrl = "http://localhost:3000/app";
    private const string StartupRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string StartupValueName = "ReportFlow";
    private static Mutex instanceMutex;
    private static Process serverProcess;
    private static NotifyIcon trayIcon;
    private static bool ownsServer;
    private static bool startInBackground;

    [STAThread]
    private static void Main()
    {
        startInBackground = Array.Exists(
            Environment.GetCommandLineArgs(),
            argument => String.Equals(argument, "--startup", StringComparison.OrdinalIgnoreCase));
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string webDirectory = Path.Combine(root, "web");
        bool createdNew;
        instanceMutex = new Mutex(true, @"Local\ReportFlowLauncher", out createdNew);

        if (!createdNew)
        {
            if (!startInBackground) OpenInChrome();
            return;
        }

        if (!Directory.Exists(webDirectory))
        {
            MessageBox.Show(
                "ReportFlow.exe must stay in the reportflow-mvp folder beside the web folder.",
                "ReportFlow",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        if (IsPortOpen())
        {
            MessageBox.Show(
                "ReportFlow cannot start because localhost port 3000 is already in use. Close the other application and try again.",
                "ReportFlow",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return;
        }

        serverProcess = StartServer(webDirectory);
        if (serverProcess == null)
        {
            return;
        }
        ownsServer = true;
        if (!WaitUntilReady(serverProcess, TimeSpan.FromSeconds(60)))
        {
            StopOwnedServer();
            MessageBox.Show(
                "ReportFlow could not start. Run npm run build inside the web folder, then try again.",
                "ReportFlow",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        CreateTrayIcon();
        if (!startInBackground) OpenInChrome();
        Application.Run();
    }

    private static Process StartServer(string webDirectory)
    {
        string nodePath = FindNode();
        string nextEntry = Path.Combine(webDirectory, "node_modules", "next", "dist", "bin", "next");
        string productionBuild = Path.Combine(webDirectory, ".next", "BUILD_ID");
        if (nodePath == null)
        {
            MessageBox.Show("Node.js was not found. Install Node.js or add it to PATH.", "ReportFlow", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return null;
        }
        if (!File.Exists(nextEntry) || !File.Exists(productionBuild)) return null;

        ProcessStartInfo start = new ProcessStartInfo();
        start.FileName = nodePath;
        start.Arguments = Quote(nextEntry) + " start -p " + Port + " -H 127.0.0.1";
        start.WorkingDirectory = webDirectory;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WindowStyle = ProcessWindowStyle.Hidden;
        start.EnvironmentVariables["NODE_ENV"] = "production";
        start.EnvironmentVariables["PORT"] = Port.ToString();
        start.EnvironmentVariables["NEXT_TELEMETRY_DISABLED"] = "1";
        start.EnvironmentVariables["AUTH_URL"] = "http://localhost:" + Port;
        try { return Process.Start(start); }
        catch (Exception error)
        {
            MessageBox.Show("Unable to launch the ReportFlow server:\n\n" + error.Message, "ReportFlow", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return null;
        }
    }

    private static string FindNode()
    {
        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string commonPath = Path.Combine(programFiles, "nodejs", "node.exe");
        if (File.Exists(commonPath)) return commonPath;

        string pathValue = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string folder in pathValue.Split(Path.PathSeparator))
        {
            if (String.IsNullOrWhiteSpace(folder)) continue;
            string candidate = Path.Combine(folder.Trim(), "node.exe");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static bool WaitUntilReady(Process process, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            if (process.HasExited) return false;
            if (IsPortOpen()) return true;
            Thread.Sleep(300);
        }
        return false;
    }

    private static bool IsPortOpen()
    {
        try
        {
            using (TcpClient client = new TcpClient())
            {
                IAsyncResult result = client.BeginConnect("127.0.0.1", Port, null, null);
                bool connected = result.AsyncWaitHandle.WaitOne(350);
                if (!connected) return false;
                client.EndConnect(result);
                return true;
            }
        }
        catch { return false; }
    }

    private static void CreateTrayIcon()
    {
        ContextMenuStrip menu = new ContextMenuStrip();
        ToolStripMenuItem open = new ToolStripMenuItem("Open ReportFlow");
        open.Font = new Font(open.Font, FontStyle.Bold);
        open.Click += delegate { OpenInChrome(); };
        menu.Items.Add(open);
        menu.Items.Add(new ToolStripSeparator());

        ToolStripMenuItem startup = new ToolStripMenuItem("Start with Windows");
        startup.Checked = IsStartupEnabled();
        startup.CheckOnClick = true;
        startup.Click += delegate
        {
            bool requested = startup.Checked;
            if (!SetStartupEnabled(requested))
            {
                startup.Checked = !requested;
                MessageBox.Show(
                    "Windows startup could not be updated. Check your account permissions and try again.",
                    "ReportFlow",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        };
        menu.Items.Add(startup);
        menu.Items.Add(new ToolStripSeparator());

        ToolStripMenuItem exit = new ToolStripMenuItem(ownsServer ? "Stop ReportFlow and exit" : "Exit launcher");
        exit.Click += delegate { ExitApplication(); };
        menu.Items.Add(exit);

        trayIcon = new NotifyIcon();
        trayIcon.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
        trayIcon.Text = "ReportFlow — running on localhost:3000";
        trayIcon.ContextMenuStrip = menu;
        trayIcon.Visible = true;
        trayIcon.DoubleClick += delegate { OpenInChrome(); };
        trayIcon.ShowBalloonTip(2500, "ReportFlow is ready", "The app is running at localhost:3000. Double-click this icon to reopen it.", ToolTipIcon.Info);
    }

    private static bool IsStartupEnabled()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(StartupRegistryPath, false))
            {
                return key != null && key.GetValue(StartupValueName) != null;
            }
        }
        catch { return false; }
    }

    private static bool SetStartupEnabled(bool enabled)
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(StartupRegistryPath))
            {
                if (key == null) return false;
                if (enabled)
                {
                    key.SetValue(
                        StartupValueName,
                        Quote(Application.ExecutablePath) + " --startup",
                        RegistryValueKind.String);
                }
                else
                {
                    key.DeleteValue(StartupValueName, false);
                }
                return true;
            }
        }
        catch { return false; }
    }

    private static void OpenInChrome()
    {
        string chrome = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe");
        if (!File.Exists(chrome))
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            chrome = Path.Combine(local, "Google", "Chrome", "Application", "chrome.exe");
        }
        try
        {
            ProcessStartInfo browser = new ProcessStartInfo();
            if (File.Exists(chrome))
            {
                browser.FileName = chrome;
                browser.Arguments = "--new-window " + Quote(AppUrl);
            }
            else
            {
                browser.FileName = AppUrl;
            }
            browser.UseShellExecute = true;
            Process.Start(browser);
        }
        catch (Exception error)
        {
            MessageBox.Show("ReportFlow is running at " + AppUrl + ".\n\nThe browser could not be opened automatically:\n" + error.Message, "ReportFlow", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }

    private static void ExitApplication()
    {
        StopOwnedServer();
        if (trayIcon != null) trayIcon.Visible = false;
        Application.Exit();
    }

    private static void StopOwnedServer()
    {
        if (!ownsServer || serverProcess == null) return;
        try { if (!serverProcess.HasExited) serverProcess.Kill(); }
        catch { }
        ownsServer = false;
    }
}
