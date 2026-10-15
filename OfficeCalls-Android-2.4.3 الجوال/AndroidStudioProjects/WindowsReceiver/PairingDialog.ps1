function Show-OfficePairingDialog {
 $dialog=[Windows.Forms.Form]::new();$dialog.Text='ربط الهاتف وإعداد الجسر';$dialog.Size=[Drawing.Size]::new(760,880);$dialog.StartPosition='CenterParent';$dialog.RightToLeft='Yes'
 $dialog.Font=[Drawing.Font]::new('Segoe UI',11)
 if($PairingSmokeTest){$dialog.Opacity=0;$dialog.ShowInTaskbar=$false}
 $pairSmokeStarted=[DateTime]::UtcNow;$script:pairSmokePassed=$false
 $label=[Windows.Forms.Label]::new();$label.Text='اختر عنوان الشبكة التي يتصل بها الهاتف';$label.Location=[Drawing.Point]::new(20,12);$label.AutoSize=$true
 $ip=[Windows.Forms.ComboBox]::new();$ip.Location=[Drawing.Point]::new(20,40);$ip.Width=230;$ip.RightToLeft='No'
 foreach($address in $addresses){[void]$ip.Items.Add($address)};if($ip.Items.Count){$ip.SelectedIndex=0}
 $portBox=[Windows.Forms.TextBox]::new();$portBox.Text=[string]$config.port;$portBox.Location=[Drawing.Point]::new(270,40);$portBox.Width=90
 $generate=[Windows.Forms.Button]::new();$generate.Text='اقتران هاتف';$generate.Location=[Drawing.Point]::new(380,36);$generate.Size=[Drawing.Size]::new(200,36)
 $picture=[Windows.Forms.PictureBox]::new();$picture.Location=[Drawing.Point]::new(140,85);$picture.Size=[Drawing.Size]::new(450,450);$picture.SizeMode='Zoom';$picture.BackColor=[Drawing.Color]::White
 $code=[Windows.Forms.TextBox]::new();$code.ReadOnly=$true;$code.Location=[Drawing.Point]::new(160,540);$code.Size=[Drawing.Size]::new(410,40);$code.Font=[Drawing.Font]::new('Consolas',18);$code.TextAlign='Center';$code.RightToLeft='No'
 $notice=[Windows.Forms.Label]::new();$notice.Location=[Drawing.Point]::new(20,588);$notice.Size=[Drawing.Size]::new(700,45);$notice.Text='امسح الرمز بالهاتف، أو أدخل العنوان والمنفذ والرمز المؤقت. صلاحية الرمز ثلاث دقائق.'
 $generate.Add_Click({
  if($ip.Text -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)'){$notice.Text='اختر عنوان الشبكة المحلية الصحيح';return}
  if($portBox.Text -ne [string]$config.port){$notice.Text='المنفذ المعروض يخص الإعداد الحالي؛ لتغييره احفظ الإعداد ثم أعد فتح النافذة.';return}
  $notice.Text='جارٍ إنشاء رمز الاقتران…';$script:reader.BeginPair($ip.Text.Trim())
 })
 $pairTimer=[Windows.Forms.Timer]::new();$pairTimer.Interval=200
 $pairTimer.Add_Tick({
  if($PairingSmokeTest -and ([DateTime]::UtcNow-$pairSmokeStarted).TotalSeconds -gt 15){$dialog.Close();return}
  if($dialog.Tag -and [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [long]$dialog.Tag){
   $dialog.Tag=$null;$code.Clear();if($picture.Image){$picture.Image.Dispose();$picture.Image=$null}
   $notice.Text='انتهت صلاحية الرمز. اضغط اقتران هاتف لإنشاء رمز جديد.'
  }
  $raw=$script:reader.TakePair();if(-not $raw){return}
  try{$pair=$raw | ConvertFrom-Json;if($pair.error){$notice.Text='تعذر إنشاء الرمز؛ تحقق من عمل المستقبل ومن عدم تعارض المنفذ.';return}
   $bytes=[Convert]::FromBase64String($pair.qr.Substring($pair.qr.IndexOf(',')+1));$stream=[IO.MemoryStream]::new($bytes)
   try{$image=[Drawing.Image]::FromStream($stream);$bitmap=[Drawing.Bitmap]::new($image);$image.Dispose()}finally{$stream.Dispose()}
   if($picture.Image){$picture.Image.Dispose()};$picture.Image=$bitmap;$code.Text=$pair.code;$dialog.Tag=[long]$pair.expiresAt
   $expiry=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$pair.expiresAt).LocalDateTime.ToString('HH:mm:ss');$notice.Text='امسح الرمز أو استخدم رمز الاقتران. ينتهي عند '+$expiry+' — أبقِ الرمز سريًا.'
   if($PairingSmokeTest){
    if($picture.Image.Width -ne 600 -or $code.Text -notmatch '^[A-F0-9]{4}(-[A-F0-9]{4}){3}$'){throw 'INVALID_QR_RENDER'}
    $bitmap=[Drawing.Bitmap]::new($dialog.Width,$dialog.Height);try{$dialog.DrawToBitmap($bitmap,[Drawing.Rectangle]::new(0,0,$bitmap.Width,$bitmap.Height));$bitmap.Save((Join-Path $stateDirectory 'pairing-ui.png'),[Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}
    $script:pairSmokePassed=$true;$dialog.Close()
   }
  }catch{$notice.Text='تعذر عرض الرمز؛ أعد المحاولة.'}
 });$pairTimer.Start()
 $import=[Windows.Forms.Button]::new();$import.Text='ربط إعداد Office Bridge الموجود';$import.Location=[Drawing.Point]::new(20,640);$import.Size=[Drawing.Size]::new(320,38)
 $import.Add_Click({
  $picker=[Windows.Forms.OpenFileDialog]::new();$picker.Filter='ملف إعداد الجسر (*.json)|*.json';$picker.Title='اختر config.json أو site-config.json من الجسر المعتمد في المكتب'
  if($picker.ShowDialog() -eq 'OK'){
   try{& (Join-Path $PSScriptRoot 'Import-BridgeConfiguration.ps1') -BridgeConfigFile $picker.FileName -ReceiverConfigFile $configPath | Out-Null;$notice.Text='حُفظ مسار الجسر مع نسخة احتياطية. أعد تشغيل هذا البرنامج لتفعيل الربط. الخدمات القديمة لم تتوقف.'}
   catch{$notice.Text='تعذر استيراد إعداد الجسر: '+$_.Exception.Message}
  };$picker.Dispose()
 })
 $startup=[Windows.Forms.CheckBox]::new();$startup.Text='التشغيل التلقائي مع Windows';$startup.Location=[Drawing.Point]::new(380,645);$startup.Width=330
 $startup.Height=28
 $runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run';$startup.Checked=$null -ne (Get-ItemProperty -LiteralPath $runKey -Name OfficeCallsProfessional -ErrorAction SilentlyContinue)
 $startup.Add_CheckedChanged({if($startup.Checked){New-ItemProperty -LiteralPath $runKey -Name OfficeCallsProfessional -PropertyType String -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $PSScriptRoot 'OfficeCallsReceiver.ps1')+'"') -Force | Out-Null}else{Remove-ItemProperty -LiteralPath $runKey -Name OfficeCallsProfessional -ErrorAction SilentlyContinue}})
 $capture=[Windows.Forms.CheckBox]::new();$capture.Text='تشغيل التقاط الأرضي القديم ضمن هذا البرنامج بعد التحقق الميداني';$capture.Location=[Drawing.Point]::new(20,690);$capture.Width=690
 $capture.Height=32
 $capture.Enabled=[bool]$config.capturePackageDirectory;$capture.Checked=[bool]$config.startLandlineCapture
 $capture.Add_CheckedChanged({$config | Add-Member -NotePropertyName startLandlineCapture -NotePropertyValue ([bool]$capture.Checked) -Force;[IO.File]::WriteAllText($configPath,($config | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false));$notice.Text='حُفظ الاختيار لإعادة التشغيل القادمة. لا يوقف البرنامج التقاطًا قائمًا أو يشغّل نسخة ثانية.'})
 $detail=[Windows.Forms.Label]::new();$detail.Text='تأكيد الهاتف = حفظ Windows. UDP لا يؤكد ظهور GRIDCMS. حالة الموقع تظهر في السجل.';$detail.Location=[Drawing.Point]::new(20,745);$detail.Size=[Drawing.Size]::new(700,60)
 $advanced=[Windows.Forms.Button]::new();$advanced.Text='إعدادات متقدمة';$advanced.Location=[Drawing.Point]::new(585,36);$advanced.Size=[Drawing.Size]::new(140,36);$advanced.Add_Click({$dialog.Close();Show-AdvancedReceiverSettings})
 $dialog.Controls.AddRange(@($label,$ip,$portBox,$generate,$picture,$code,$notice,$import,$startup,$capture,$detail,$advanced))
 $script:reader.BeginPair($ip.Text.Trim());[void]$dialog.ShowDialog($form)
 $pairTimer.Stop();$pairTimer.Dispose();if($picture.Image){$picture.Image.Dispose()};$dialog.Dispose()
 if($PairingSmokeTest){if(-not $script:pairSmokePassed){throw 'PAIRING_UI_SMOKE_FAILED'};Write-Output 'PAIRING_UI_SMOKE_PASS'}
}
