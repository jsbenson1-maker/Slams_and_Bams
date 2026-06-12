using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
using System.Diagnostics;

namespace PhyzixUninstaller
{
    public class UninstallerForm : Form
    {
        private Button btnUninstall;
        private Button btnCancel;
        private ProgressBar progressBar;
        private Label lblStatus;
        private Label lblHeader;
        private Label lblSubtitle;

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new UninstallerForm());
        }

        public UninstallerForm()
        {
            // Set window characteristics matching Phyzix neomorphic styling
            this.Text = "Phyzix: Slams and Bams Uninstaller";
            this.Size = new Size(480, 260);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MinimizeBox = false;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(247, 246, 240); // off-white sand

            InitializeControls();
        }

        private void InitializeControls()
        {
            // 1. Banner Title Header Label
            lblHeader = new Label();
            lblHeader.Text = "UNINSTALL PHYZIX";
            lblHeader.Font = new Font("Outfit", 15F, FontStyle.Bold);
            lblHeader.ForeColor = Color.FromArgb(43, 41, 39); // dark primary text
            lblHeader.Location = new Point(25, 20);
            lblHeader.Size = new Size(430, 25);
            this.Controls.Add(lblHeader);

            lblSubtitle = new Label();
            lblSubtitle.Text = "Remove Phyzix: Slams and Bams standalone & audio plugins.";
            lblSubtitle.Font = new Font("Outfit", 8.5F, FontStyle.Regular);
            lblSubtitle.ForeColor = Color.FromArgb(112, 107, 100); // secondary text
            lblSubtitle.Location = new Point(27, 48);
            lblSubtitle.Size = new Size(430, 20);
            this.Controls.Add(lblSubtitle);

            // 2. Status Label
            lblStatus = new Label();
            lblStatus.Text = "Ready to completely remove the application and plugins.";
            lblStatus.Font = new Font("Outfit", 9F, FontStyle.Italic);
            lblStatus.ForeColor = Color.FromArgb(112, 107, 100);
            lblStatus.Location = new Point(25, 95);
            lblStatus.Size = new Size(430, 25);
            this.Controls.Add(lblStatus);

            // 3. Progress Bar
            progressBar = new ProgressBar();
            progressBar.Location = new Point(25, 125);
            progressBar.Size = new Size(410, 18);
            progressBar.Visible = false;
            this.Controls.Add(progressBar);

            // 4. Cancel Button
            btnCancel = new Button();
            btnCancel.Text = "CANCEL";
            btnCancel.Font = new Font("JetBrains Mono", 9F, FontStyle.Bold);
            btnCancel.BackColor = Color.White;
            btnCancel.FlatStyle = FlatStyle.Flat;
            btnCancel.FlatAppearance.BorderColor = Color.FromArgb(0, 0, 0, 30);
            btnCancel.Location = new Point(220, 160);
            btnCancel.Size = new Size(100, 35);
            btnCancel.Cursor = Cursors.Hand;
            btnCancel.Click += (s, e) => this.Close();
            this.Controls.Add(btnCancel);

            // 5. Uninstall Button
            btnUninstall = new Button();
            btnUninstall.Text = "UNINSTALL";
            btnUninstall.Font = new Font("JetBrains Mono", 9F, FontStyle.Bold);
            btnUninstall.BackColor = Color.FromArgb(224, 108, 67); // Phyzix orange
            btnUninstall.ForeColor = Color.White;
            btnUninstall.FlatStyle = FlatStyle.Flat;
            btnUninstall.FlatAppearance.BorderSize = 0;
            btnUninstall.Location = new Point(335, 160);
            btnUninstall.Size = new Size(100, 35);
            btnUninstall.Cursor = Cursors.Hand;
            btnUninstall.Click += BtnUninstall_Click;
            this.Controls.Add(btnUninstall);
        }

        private void BtnUninstall_Click(object sender, EventArgs e)
        {
            var confirm = MessageBox.Show(
                "Are you sure you want to completely remove Phyzix: Slams and Bams, its desktop shortcuts, and its DAW plugins?",
                "Confirm Uninstall",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning
            );

            if (confirm != DialogResult.Yes) return;

            btnUninstall.Enabled = false;
            btnCancel.Enabled = false;
            progressBar.Visible = true;
            progressBar.Value = 10;
            lblStatus.Text = "Removing Desktop shortcut...";
            Application.DoEvents();

            try
            {
                // 1. Delete Desktop Shortcut
                string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string shortcutPath = Path.Combine(desktopPath, "Phyzix SnB.lnk");
                if (File.Exists(shortcutPath))
                {
                    File.Delete(shortcutPath);
                }

                progressBar.Value = 30;
                lblStatus.Text = "Removing VST3 plugin...";
                Application.DoEvents();

                // 2. Delete VST3 Plugin Folder
                string vst3SystemPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles), "VST3", "PhyzixSnB.vst3");
                if (Directory.Exists(vst3SystemPath))
                {
                    Directory.Delete(vst3SystemPath, true);
                }

                progressBar.Value = 45;
                lblStatus.Text = "Removing VST2 plugin...";
                Application.DoEvents();

                // Delete VST2 Plugin DLL
                string vst2SystemPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "VSTPlugins", "PhyzixSnB.dll");
                if (File.Exists(vst2SystemPath))
                {
                    File.Delete(vst2SystemPath);
                }

                progressBar.Value = 60;
                lblStatus.Text = "Removing AAX plugin...";
                Application.DoEvents();

                // 3. Delete AAX Plugin Folder
                string aaxSystemPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles), "Avid", "Audio", "Plug-Ins", "PhyzixSnB.aaxplugin");
                if (Directory.Exists(aaxSystemPath))
                {
                    Directory.Delete(aaxSystemPath, true);
                }

                progressBar.Value = 85;
                lblStatus.Text = "Preparing standalone folder deletion...";
                Application.DoEvents();

                // Get current directory where uninstaller is running (installation folder)
                string installDir = AppDomain.CurrentDomain.BaseDirectory;
                string tempScriptPath = Path.Combine(Path.GetTempPath(), "phyzix_cleanup.bat");

                // Write a temporary batch file that waits for the uninstaller to exit,
                // deletes the installation directory and the batch file itself.
                string batContent = string.Format(
                    "@echo off\r\n" +
                    "timeout /t 1 /nobreak > nul\r\n" +
                    "rmdir /s /q \"{0}\"\r\n" +
                    "del \"{1}\"\r\n",
                    installDir.TrimEnd('\\'),
                    tempScriptPath
                );
                File.WriteAllText(tempScriptPath, batContent);

                progressBar.Value = 100;
                lblStatus.Text = "Uninstall completed successfully!";
                Application.DoEvents();

                MessageBox.Show(
                    "Phyzix: Slams and Bams has been successfully removed from your computer.",
                    "Uninstall Success",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );

                // Run batch script and exit to let it delete the directory
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = tempScriptPath;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi);

                this.Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "An error occurred during uninstallation:\n\n" + ex.Message,
                    "Uninstall Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                btnUninstall.Enabled = true;
                btnCancel.Enabled = true;
                progressBar.Visible = false;
                lblStatus.Text = "Uninstall failed. Ready to retry.";
            }
        }
    }
}
