# Generates synthetic demo documents (PNG) for every persona in personas.json.
# Run once: powershell -File seed-assets/generate-docs.ps1   (Windows, System.Drawing)
Add-Type -AssemblyName System.Drawing
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$people = Get-Content (Join-Path $here 'personas.json') -Raw | ConvertFrom-Json
$out = Join-Path $here 'docs'
New-Item -ItemType Directory -Force $out | Out-Null

function New-Doc($path, [string[]]$lines, [bool]$blurry = $false) {
  $w = 1000; $h = 640
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $title = New-Object System.Drawing.Font 'Arial', 26, ([System.Drawing.FontStyle]::Bold)
  $body = New-Object System.Drawing.Font 'Arial', 28
  $g.DrawRectangle((New-Object System.Drawing.Pen ([System.Drawing.Color]::Black), 3), 14, 14, ($w - 28), ($h - 28))
  $g.DrawString($lines[0], $title, [System.Drawing.Brushes]::Black, 44, 40)
  $y = 130
  foreach ($l in $lines[1..($lines.Count - 1)]) { $g.DrawString($l, $body, [System.Drawing.Brushes]::Black, 44, $y); $y += 62 }
  $g.Dispose()
  if ($blurry) {
    # Simulate a bad phone photo: shrink hard, enlarge with smoothing, add noise.
    $small = New-Object System.Drawing.Bitmap $bmp, 110, 70
    $b2 = New-Object System.Drawing.Bitmap $w, $h
    $g2 = [System.Drawing.Graphics]::FromImage($b2)
    $g2.InterpolationMode = 'HighQualityBicubic'
    $g2.DrawImage($small, 0, 0, $w, $h); $g2.Dispose()
    $rnd = New-Object System.Random 7
    for ($i = 0; $i -lt 60000; $i++) { $b2.SetPixel($rnd.Next($w), $rnd.Next($h), [System.Drawing.Color]::FromArgb(150, 150, 150)) }
    $bmp.Dispose(); $bmp = $b2
  }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

foreach ($p in $people) {
  if ($p.docs -and $p.docs.Count -eq 0) { continue }   # draft persona: no uploads
  $k = $p.key
  New-Doc (Join-Path $out "${k}_id_proof.png") @('UNIQUE IDENTIFICATION CARD', "Name: $($p.name)", "Aadhaar No: $($p.aadhaar)", 'DOB: 14/08/1978', 'Address: Goa')
  if ($p.scheme -eq 'land_acquisition') {
    New-Doc (Join-Path $out "${k}_land_title.png") @('LAND TITLE DEED - GOVERNMENT OF GOA', "Owner Name: $($p.name)", "Survey No: $($p.survey)", "Village: $($p.village)", 'Registered: 12/03/2009')
    $blur = ($p.flag -eq 'blurry_survey')
    New-Doc (Join-Path $out "${k}_survey_extract.png") @('FORM I and XIV - SURVEY EXTRACT', "Owner Name: $($p.name)", "Survey No: $($p.survey)", "Area: $($p.area) sq m", "Classification: $($p.cls)") $blur
    New-Doc (Join-Path $out "${k}_ownership_papers.png") @('OWNERSHIP CERTIFICATE', "Holder Name: $($p.name)", "Survey No: $($p.survey)", "Taluka: $($p.taluka)", 'Issued: Mamlatdar Office')
  } else {
    New-Doc (Join-Path $out "${k}_residence_proof.png") @('RESIDENCE CERTIFICATE - VILLAGE PANCHAYAT', "Resident Name: $($p.name)", "Village: $($p.village)", 'Resident since: 1999')
  }
}
Write-Host "Generated documents in $out"
