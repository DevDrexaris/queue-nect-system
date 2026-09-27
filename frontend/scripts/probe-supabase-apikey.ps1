$envFile = Join-Path $PSScriptRoot "..\.env.example"
$lines = Get-Content $envFile
$key = ($lines | Where-Object { $_ -like 'VITE_SUPABASE_PUBLISHABLE_KEY=*' }) -replace '^VITE_SUPABASE_PUBLISHABLE_KEY=',''
$url = ($lines | Where-Object { $_ -like 'VITE_SUPABASE_URL=*' }) -replace '^VITE_SUPABASE_URL=',''
$endpoint = "$url/rest/v1/profiles?select=id&limit=1"

function Probe($name, $headerHash) {
  try {
    $resp = Invoke-WebRequest -Uri $endpoint -Headers $headerHash -Method GET -UseBasicParsing
    $body = $resp.Content
    if ($body.Length -gt 220) { $body = $body.Substring(0,220) }
    Write-Output ("PROBE " + $name + " status=" + [int]$resp.StatusCode + " body=" + $body)
  } catch {
    $ex = $_.Exception
    $r = $ex.Response
    $code = 0
    $text = $ex.Message
    if ($r) {
      $code = [int]$r.StatusCode
      try {
        $stream = $r.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $text = $reader.ReadToEnd()
        $reader.Close()
      } catch {}
    }
    if ($text.Length -gt 220) { $text = $text.Substring(0,220) }
    Write-Output ("PROBE " + $name + " status=" + $code + " body=" + $text)
  }
}

Write-Output ("key_prefix=" + $key.Substring(0, [Math]::Min(15,$key.Length)))
Write-Output ("key_length=" + $key.Length)
Write-Output ("url_host=" + ([Uri]$url).Host)

Probe "no-headers" @{}
Probe "apikey-only" @{ apikey = $key }
Probe "authorization-bearer-key" @{ Authorization = ("Bearer " + $key) }
Probe "both-apikey-and-bearer-key" @{ apikey = $key; Authorization = ("Bearer " + $key) }
Probe "apikey-capital-A" @{ ApiKey = $key }
Probe "garbage-apikey" @{ apikey = "not-a-real-key" }
