function Show-AdvancedReceiverSettings {
 $window=[Windows.Forms.Form]::new();$window.Text='إعدادات المستقبل المتقدمة';$window.Size=[Drawing.Size]::new(620,340);$window.StartPosition='CenterParent';$window.RightToLeft='Yes'
 $labels=[Windows.Forms.Label]::new();$labels.Text='منفذ الاتصال الآمن           حفظ السجل بالأيام (1–365)';$labels.Location=[Drawing.Point]::new(20,20);$labels.Size=[Drawing.Size]::new(560,30)
 $portField=[Windows.Forms.TextBox]::new();$portField.Text=[string]$config.port;$portField.Location=[Drawing.Point]::new(20,60);$portField.Width=180
 $days=[Windows.Forms.TextBox]::new();$days.Text=[string]$config.retentionDays;$days.Location=[Drawing.Point]::new(240,60);$days.Width=180
 $legacy=[Windows.Forms.CheckBox]::new();$legacy.Text='استقبال Agent القديم على TCP 5050 من هذا الكمبيوتر فقط';$legacy.Location=[Drawing.Point]::new(20,110);$legacy.Width=550;$legacy.Checked=[bool]$config.legacyTcpPort
 $note=[Windows.Forms.Label]::new();$note.Text='يتطلب تفعيل المنفذ القديم نجاح اختبار النسخة المتوافقة وإخلاء المنفذ يدويًا. لا يوقف البرنامج خدمات أخرى.';$note.Location=[Drawing.Point]::new(20,150);$note.Size=[Drawing.Size]::new(550,60)
 $save=[Windows.Forms.Button]::new();$save.Text='حفظ وإعادة تشغيل هذا المستقبل';$save.Location=[Drawing.Point]::new(20,230);$save.Size=[Drawing.Size]::new(550,40)
 $save.Add_Click({
  $value=0;$retention=0
  if(-not [int]::TryParse($portField.Text,[ref]$value) -or $value -lt 1 -or $value -gt 65535 -or -not [int]::TryParse($days.Text,[ref]$retention) -or $retention -lt 1 -or $retention -gt 365 -or ($legacy.Checked -and $value -eq 5050)){$note.Text='تحقق من المنفذ والمدة؛ لا تستخدم المنفذ نفسه للبروتوكولين.';return}
  foreach($checkPort in @($value,$(if($legacy.Checked){5050})) | Where-Object {$_}){
   if($checkPort -eq $config.port -or ($config.legacyTcpPort -and $checkPort -eq $config.legacyTcpPort)){continue}
   $probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Any,[int]$checkPort)
   try{$probe.Start()}catch{$note.Text='المنفذ مستخدم؛ بقيت الخدمات الحالية والإعدادات محفوظة.';return}finally{$probe.Stop()}
  }
  Copy-Item -LiteralPath $configPath -Destination ($configPath+'.before-settings-'+(Get-Date -Format yyyyMMddHHmmss))
  $config.port=$value;$config.retentionDays=$retention
  $config | Add-Member -NotePropertyName legacyTcpPort -NotePropertyValue $(if($legacy.Checked){5050}else{$null}) -Force
  $config | Add-Member -NotePropertyName legacyTcpHost -NotePropertyValue '127.0.0.1' -Force
  [IO.File]::WriteAllText($configPath,($config | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
  if($script:workerJob){$script:workerJob.Dispose()};if(-not $script:worker.HasExited){$script:worker.Kill();[void]$script:worker.WaitForExit(3000)}
  Start-LocalWorker;$window.Close()
 })
 $window.Controls.AddRange(@($labels,$portField,$days,$legacy,$note,$save));[void]$window.ShowDialog($form);$window.Dispose()
}
