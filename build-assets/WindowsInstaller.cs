using System;
using System.IO;
using System.IO.Compression;
using System.Drawing;
using System.Windows.Forms;
using System.Diagnostics;

namespace PhyzixInstaller
{
    public class InstallerForm : Form
    {
        private TextBox txtInstallPath;
        private FolderBrowserDialog folderBrowser;
        private CheckBox chkStandalone;
        private CheckBox chkVst3;
        private CheckBox chkVst2;
        private CheckBox chkAax;
        private Button btnBrowse;
        private Button btnInstall;
        private ProgressBar progressBar;
        private Label lblStatus;
        private string payloadZipName = "payload.zip";

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }

        public InstallerForm()
        {
            // Set window characteristics matching Phyzix neomorphic styling
            this.Text = "Phyzix: Slams and Bams (v1.4.0) Installer";
            this.Size = new Size(540, 420);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(247, 246, 240); // off-white sand

            folderBrowser = new FolderBrowserDialog();
            InitializeControls();
        }

        private void InitializeControls()
        {
            // 1. Banner Title Header Label
            Label lblHeader = new Label();
            lblHeader.Text = "PHYZIX: SLAMS AND BAMS";
            lblHeader.Font = new Font("Outfit", 16F, FontStyle.Bold);
            lblHeader.ForeColor = Color.FromArgb(43, 41, 39); // dark primary text
            lblHeader.Location = new Point(25, 20);
            lblHeader.Size = new Size(480, 30);
            this.Controls.Add(lblHeader);

            Label lblSubtitle = new Label();
            lblSubtitle.Text = "Multi-Format Studio Installer (Standalone, VST3, and AAX)";
            lblSubtitle.Font = new Font("Outfit", 8.5F, FontStyle.Regular);
            lblSubtitle.ForeColor = Color.FromArgb(112, 107, 100); // secondary text
            lblSubtitle.Location = new Point(27, 50);
            lblSubtitle.Size = new Size(480, 20);
            this.Controls.Add(lblSubtitle);

            // 2. Installation Path Box Container
            GroupBox grpPath = new GroupBox();
            grpPath.Text = "INSTALLATION DIRECTORY (STANDALONE)";
            grpPath.Font = new Font("JetBrains Mono", 7.5F, FontStyle.Bold);
            grpPath.ForeColor = Color.FromArgb(112, 107, 100);
            grpPath.Location = new Point(25, 80);
            grpPath.Size = new Size(475, 75);
            this.Controls.Add(grpPath);

            txtInstallPath = new TextBox();
            txtInstallPath.Font = new Font("Outfit", 9.5F, FontStyle.Regular);
            txtInstallPath.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Phyzix", "Slams and Bams");
            txtInstallPath.Location = new Point(15, 30);
            txtInstallPath.Size = new Size(350, 25);
            grpPath.Controls.Add(txtInstallPath);

            btnBrowse = new Button();
            btnBrowse.Text = "BROWSE...";
            btnBrowse.Font = new Font("JetBrains Mono", 8F, FontStyle.Bold);
            btnBrowse.BackColor = Color.White;
            btnBrowse.FlatStyle = FlatStyle.Flat;
            btnBrowse.FlatAppearance.BorderColor = Color.FromArgb(0, 0, 0, 30);
            btnBrowse.Location = new Point(375, 29);
            btnBrowse.Size = new Size(85, 25);
            btnBrowse.Cursor = Cursors.Hand;
            btnBrowse.Click += BtnBrowse_Click;
            grpPath.Controls.Add(btnBrowse);

            // 3. Format Target Choices Checklist Box
            GroupBox grpFormats = new GroupBox();
            grpFormats.Text = "STUDIO PLUG-IN FORMAT CHECKLIST";
            grpFormats.Font = new Font("JetBrains Mono", 7.5F, FontStyle.Bold);
            grpFormats.ForeColor = Color.FromArgb(112, 107, 100);
            grpFormats.Location = new Point(25, 170);
            grpFormats.Size = new Size(475, 120);
            this.Controls.Add(grpFormats);

            chkStandalone = new CheckBox();
            chkStandalone.Text = "Standalone Desktop App (Required)";
            chkStandalone.Font = new Font("Outfit", 9.5F, FontStyle.Bold);
            chkStandalone.Checked = true;
            chkStandalone.Enabled = false; // Always required
            chkStandalone.Location = new Point(20, 25);
            chkStandalone.Size = new Size(400, 25);
            grpFormats.Controls.Add(chkStandalone);

            chkVst3 = new CheckBox();
            chkVst3.Text = "VST3 DAW Plug-In (64-bit)";
            chkVst3.Font = new Font("Outfit", 9.5F, FontStyle.Regular);
            chkVst3.Checked = true;
            chkVst3.Location = new Point(20, 50);
            chkVst3.Size = new Size(400, 20);
            grpFormats.Controls.Add(chkVst3);

            chkVst2 = new CheckBox();
            chkVst2.Text = "Standard VST2 DAW Plug-In (64-bit)";
            chkVst2.Font = new Font("Outfit", 9.5F, FontStyle.Regular);
            chkVst2.Checked = true;
            chkVst2.Location = new Point(20, 72);
            chkVst2.Size = new Size(400, 20);
            grpFormats.Controls.Add(chkVst2);

            chkAax = new CheckBox();
            chkAax.Text = "AAX Pro Tools Plug-In (64-bit)";
            chkAax.Font = new Font("Outfit", 9.5F, FontStyle.Regular);
            chkAax.Checked = false;
            chkAax.Location = new Point(20, 94);
            chkAax.Size = new Size(400, 20);
            grpFormats.Controls.Add(chkAax);

            // 4. Progress bar & status line
            progressBar = new ProgressBar();
            progressBar.Location = new Point(25, 305);
            progressBar.Size = new Size(475, 18);
            progressBar.Visible = false;
            this.Controls.Add(progressBar);

            lblStatus = new Label();
            lblStatus.Text = "Ready to deploy Slams and Bams drum machine.";
            lblStatus.Font = new Font("Outfit", 8.5F, FontStyle.Italic);
            lblStatus.ForeColor = Color.FromArgb(112, 107, 100);
            lblStatus.Location = new Point(25, 330);
            lblStatus.Size = new Size(350, 20);
            this.Controls.Add(lblStatus);

            // 5. Install Button
            btnInstall = new Button();
            btnInstall.Text = "INSTALL NOW";
            btnInstall.Font = new Font("JetBrains Mono", 9.5F, FontStyle.Bold);
            btnInstall.BackColor = Color.FromArgb(224, 108, 67); // Phyzix signature orange accent
            btnInstall.ForeColor = Color.White;
            btnInstall.FlatStyle = FlatStyle.Flat;
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Location = new Point(375, 328);
            btnInstall.Size = new Size(125, 35);
            btnInstall.Cursor = Cursors.Hand;
            btnInstall.Click += BtnInstall_Click;
            this.Controls.Add(btnInstall);
        }

        private void BtnBrowse_Click(object sender, EventArgs e)
        {
            if (folderBrowser.ShowDialog() == DialogResult.OK)
            {
                txtInstallPath.Text = folderBrowser.SelectedPath;
            }
        }

        private void BtnInstall_Click(object sender, EventArgs e)
        {
            btnInstall.Enabled = false;
            btnBrowse.Enabled = false;
            txtInstallPath.Enabled = false;
            chkVst3.Enabled = false;
            chkVst2.Enabled = false;
            chkAax.Enabled = false;

            progressBar.Visible = true;
            progressBar.Value = 10;
            lblStatus.Text = "Analyzing staging folders...";
            Application.DoEvents();

            try
            {
                string targetDir = txtInstallPath.Text.Trim();
                if (string.IsNullOrEmpty(targetDir))
                {
                    MessageBox.Show("Please specify a valid installation target folder.", "Invalid Path", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    ResetControls();
                    return;
                }

                // Create standalone target dir
                Directory.CreateDirectory(targetDir);
                progressBar.Value = 30;

                // Extraction helper - check if zip payload is embedded in resource or local
                byte[] zipBytes = null;
                System.Reflection.Assembly assembly = System.Reflection.Assembly.GetExecutingAssembly();
                
                // Search for embedded payload resources
                foreach (string name in assembly.GetManifestResourceNames())
                {
                    if (name.EndsWith("payload.zip", StringComparison.OrdinalIgnoreCase))
                    {
                        using (Stream s = assembly.GetManifestResourceStream(name))
                        {
                            zipBytes = new byte[s.Length];
                            s.Read(zipBytes, 0, zipBytes.Length);
                        }
                        break;
                    }
                }

                string tempZipPath = Path.Combine(Path.GetTempPath(), "phyzix_payload.zip");
                if (zipBytes != null)
                {
                    lblStatus.Text = "Extracting embedded payload...";
                    File.WriteAllBytes(tempZipPath, zipBytes);
                }
                else if (File.Exists(payloadZipName))
                {
                    lblStatus.Text = "Copying local payload...";
                    File.Copy(payloadZipName, tempZipPath, true);
                }
                else
                {
                    MessageBox.Show("Payload ZIP package ('payload.zip') not found! Please run full bundler setup scripts.", "Resource Missing", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    ResetControls();
                    return;
                }

                progressBar.Value = 50;
                lblStatus.Text = "Unpacking standalone files...";
                Application.DoEvents();

                // Extract standalone files to target directory using ZipFile
                using (ZipArchive archive = ZipFile.OpenRead(tempZipPath))
                {
                    int totalFiles = archive.Entries.Count;
                    int extracted = 0;

                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        // Safely compute target extraction file path
                        string destPath = Path.GetFullPath(Path.Combine(targetDir, entry.FullName));
                        if (!destPath.StartsWith(targetDir, StringComparison.OrdinalIgnoreCase)) continue; // Directory traversal check

                        if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\"))
                        {
                            Directory.CreateDirectory(destPath);
                        }
                        else
                        {
                            Directory.CreateDirectory(Path.GetDirectoryName(destPath));
                            
                            // If VST3 or AAX and user unchecked them, bypass copying them
                            bool isVstFile = entry.FullName.IndexOf("vst3", StringComparison.OrdinalIgnoreCase) >= 0;
                            bool isVst2File = entry.FullName.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) && entry.FullName.IndexOf("PhyzixSnBUninstall", StringComparison.OrdinalIgnoreCase) < 0;
                            bool isAaxFile = entry.FullName.IndexOf("aax", StringComparison.OrdinalIgnoreCase) >= 0;

                            if (isVstFile && !chkVst3.Checked) continue;
                            if (isVst2File && !chkVst2.Checked) continue;
                            if (isAaxFile && !chkAax.Checked) continue;

                            entry.ExtractToFile(destPath, true);
                        }

                        extracted++;
                        if (extracted % 50 == 0)
                        {
                            progressBar.Value = 50 + (int)((extracted / (float)totalFiles) * 35);
                            Application.DoEvents();
                        }
                    }
                }

                // Cleanup temporary payload zip
                if (File.Exists(tempZipPath))
                {
                    File.Delete(tempZipPath);
                }

                progressBar.Value = 85;
                lblStatus.Text = "Installing system DAW plugins...";
                Application.DoEvents();

                // Copy VST3 plugin if checked
                if (chkVst3.Checked)
                {
                    string vst3SystemPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles), "VST3");
                    Directory.CreateDirectory(vst3SystemPath);
                    string localVstFolder = Path.Combine(targetDir, "PhyzixSnB.vst3");
                    
                    if (Directory.Exists(localVstFolder))
                    {
                        // Copy folder recursively or copy stub DLL
                        string destVstFolder = Path.Combine(vst3SystemPath, "PhyzixSnB.vst3");
                        CopyDirectory(localVstFolder, destVstFolder);
                    }
                }

                // Copy VST2 plugin if checked
                if (chkVst2.Checked)
                {
                    string vst2SystemPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "VSTPlugins");
                    Directory.CreateDirectory(vst2SystemPath);
                    string localVst2File = Path.Combine(targetDir, "PhyzixSnB.dll");
                    
                    if (File.Exists(localVst2File))
                    {
                        string destVst2File = Path.Combine(vst2SystemPath, "PhyzixSnB.dll");
                        File.Copy(localVst2File, destVst2File, true);
                    }
                }

                // Copy AAX plugin if checked
                if (chkAax.Checked)
                {
                    string aaxSystemPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles), "Avid", "Audio", "Plug-Ins");
                    Directory.CreateDirectory(aaxSystemPath);
                    string localAaxFolder = Path.Combine(targetDir, "PhyzixSnB.aaxplugin");
                    
                    if (Directory.Exists(localAaxFolder))
                    {
                        string destAaxFolder = Path.Combine(aaxSystemPath, "PhyzixSnB.aaxplugin");
                        CopyDirectory(localAaxFolder, destAaxFolder);
                    }
                }

                progressBar.Value = 95;
                lblStatus.Text = "Creating shortcuts...";
                Application.DoEvents();

                // Create Shortcut on Desktop pointing to PhyzixSnB.exe
                string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string shortcutPath = Path.Combine(desktopPath, "Phyzix SnB.lnk");
                string appExePath = Path.Combine(targetDir, "PhyzixSnB.exe");

                if (File.Exists(appExePath))
                {
                    CreateLink(shortcutPath, appExePath, "Phyzix: Slams and Bams Synthesizer");
                }

                progressBar.Value = 100;
                lblStatus.Text = "Installation completed successfully!";
                Application.DoEvents();

                MessageBox.Show("Phyzix: Slams and Bams was installed successfully!\n\nStandalone executable is ready on your Desktop.\nPlug-ins have been registered in your DAW path.", "Installation Success", MessageBoxButtons.OK, MessageBoxIcon.Information);
                this.Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show("An error occurred during installation:\n\n" + ex.Message, "Installation Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                ResetControls();
            }
        }

        private void ResetControls()
        {
            btnInstall.Enabled = true;
            btnBrowse.Enabled = true;
            txtInstallPath.Enabled = true;
            chkVst3.Enabled = true;
            chkVst2.Enabled = true;
            chkAax.Enabled = true;
            progressBar.Visible = false;
            lblStatus.Text = "Installation failed. Ready to re-run.";
        }

        private static void CopyDirectory(string sourceDir, string destinationDir)
        {
            Directory.CreateDirectory(destinationDir);

            foreach (string file in Directory.GetFiles(sourceDir))
            {
                string dest = Path.Combine(destinationDir, Path.GetFileName(file));
                File.Copy(file, dest, true);
            }

            foreach (string folder in Directory.GetDirectories(sourceDir))
            {
                string dest = Path.Combine(destinationDir, Path.GetFileName(folder));
                CopyDirectory(folder, dest);
            }
        }

        private static void CreateLink(string shortcutPath, string targetPath, string description)
        {
            try
            {
                Type t = Type.GetTypeFromCLSID(new Guid("72C24DD5-D70A-438B-8A42-98424B88AFB8")); // Windows Script Host Shell CLSID
                dynamic shell = Activator.CreateInstance(t);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
                shortcut.Description = description;
                shortcut.Save();
            }
            catch
            {
                // Fallback silently if WSH fails
            }
        }
    }
}
