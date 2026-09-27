$js = (Invoke-WebRequest -Uri "https://queuenect.vercel.app/assets/index-JYLHVoj2.js" -UseBasicParsing).Content
function Redact([string]$s) {
  return ($s -replace 'sb_publishable_[A-Za-z0-9_-]+','sb_publishable_<redacted>' -replace 'eyJ[A-Za-z0-9._-]{10,}','eyJ<redacted>')
}

Write-Output ("len=" + $js.Length)
Write-Output ("missing_url_throw=" + $js.Contains("VITE_SUPABASE_URL is missing"))
Write-Output ("missing_key_throw=" + $js.Contains("VITE_SUPABASE_PUBLISHABLE_KEY is missing"))
Write-Output ("supabaseKey_required=" + $js.Contains("supabaseKey is required"))
Write-Output ("empty_or_fallback=" + $js.Contains("||''"))

$urlCount = [regex]::Matches($js, "hckvwvrhmmwqxlbthafe").Count
Write-Output ("url_count=" + $urlCount)

$pos = 0
$n = 0
while (($pos = $js.IndexOf("hckvwvrhmmwqxlbthafe", $pos)) -ge 0 -and $n -lt 8) {
  $n++
  $s = [Math]::Max(0, $pos - 250)
  Write-Output ("URLCTX $n")
  Write-Output (Redact $js.Substring($s, [Math]::Min(600, $js.Length - $s)))
  $pos++
}

$matches = [regex]::Matches($js, "sb_publishable_[A-Za-z0-9_-]{10,}")
Write-Output ("publishable_literals=" + $matches.Count)
foreach ($m in $matches) {
  Write-Output ("lit_len=" + $m.Value.Length + " idx=" + $m.Index)
  $s = [Math]::Max(0, $m.Index - 180)
  Write-Output (Redact $js.Substring($s, [Math]::Min(420, $js.Length - $s)))
}

Write-Output ("contains_import_meta=" + $js.Contains("import.meta"))
Write-Output ("contains_VITE_SUPABASE_PUBLISHABLE_KEY=" + $js.Contains("VITE_SUPABASE_PUBLISHABLE_KEY"))
Write-Output ("contains_VITE_SUPABASE_ANON_KEY=" + $js.Contains("VITE_SUPABASE_ANON_KEY"))
