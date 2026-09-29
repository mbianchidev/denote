param(
  [Parameter(Mandatory = $true)]
  [string] $AppPath,

  [Parameter(Mandatory = $true)]
  [string] $EvidenceDirectory,

  [int] $RenderTimeoutSeconds = 45,

  [int] $ExitTimeoutSeconds = 20
)

$ErrorActionPreference = "Stop"

$resolvedApp = (Resolve-Path -LiteralPath $AppPath).Path
if ([System.IO.Path]::GetFileName($resolvedApp) -cne "denote.exe") {
  throw "AppPath must point to denote.exe."
}
if ($RenderTimeoutSeconds -lt 5 -or $RenderTimeoutSeconds -gt 120) {
  throw "RenderTimeoutSeconds must be between 5 and 120."
}
if ($ExitTimeoutSeconds -lt 5 -or $ExitTimeoutSeconds -gt 60) {
  throw "ExitTimeoutSeconds must be between 5 and 60."
}

New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$resolvedEvidence = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$screenshotPath = Join-Path $resolvedEvidence "renderer.png"
$metricsPath = Join-Path $resolvedEvidence "metrics.json"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class DenoteSmokeNative
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out Rect rect);

    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref Point point);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    [DllImport("user32.dll")]
    public static extern bool PostMessage(
        IntPtr hWnd,
        uint message,
        IntPtr wParam,
        IntPtr lParam
    );

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Point
    {
        public int X;
        public int Y;
    }

    public struct WindowInfo
    {
        public IntPtr Handle;
        public int X;
        public int Y;
        public int Width;
        public int Height;
    }

    public static WindowInfo FindLargestVisibleWindow(int processId)
    {
        WindowInfo best = new WindowInfo();
        EnumWindows(delegate (IntPtr hWnd, IntPtr lParam)
        {
            uint windowProcessId;
            GetWindowThreadProcessId(hWnd, out windowProcessId);
            if (windowProcessId != processId || !IsWindowVisible(hWnd))
            {
                return true;
            }

            WindowInfo candidate = GetWindowInfo(hWnd);
            long bestArea = (long)best.Width * best.Height;
            long candidateArea = (long)candidate.Width * candidate.Height;
            if (candidateArea > bestArea)
            {
                best = candidate;
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    public static WindowInfo GetWindowInfo(IntPtr hWnd)
    {
        Rect rect;
        if (!GetClientRect(hWnd, out rect))
        {
            return new WindowInfo();
        }
        Point point = new Point();
        if (!ClientToScreen(hWnd, ref point))
        {
            return new WindowInfo();
        }
        return new WindowInfo
        {
            Handle = hWnd,
            X = point.X,
            Y = point.Y,
            Width = rect.Right - rect.Left,
            Height = rect.Bottom - rect.Top,
        };
    }
}
"@

try {
  [DenoteSmokeNative]::SetProcessDPIAware() | Out-Null
} catch {
  # The PowerShell host may already have a DPI-awareness context.
}

function Measure-RenderedFrame {
  param([System.Drawing.Bitmap] $Bitmap)

  $colorBuckets = @{}
  $brightSamples = 0
  $darkSamples = 0
  $samples = 0
  $minimumLuminance = 255
  $maximumLuminance = 0
  $stepX = [Math]::Max(1, [Math]::Floor($Bitmap.Width / 120))
  $stepY = [Math]::Max(1, [Math]::Floor($Bitmap.Height / 80))

  for ($y = 0; $y -lt $Bitmap.Height; $y += $stepY) {
    for ($x = 0; $x -lt $Bitmap.Width; $x += $stepX) {
      $color = $Bitmap.GetPixel($x, $y)
      $luminance = [int][Math]::Round(
        (0.2126 * $color.R) + (0.7152 * $color.G) + (0.0722 * $color.B)
      )
      $minimumLuminance = [Math]::Min($minimumLuminance, $luminance)
      $maximumLuminance = [Math]::Max($maximumLuminance, $luminance)
      if ($luminance -ge 90) {
        $brightSamples++
      }
      if ($luminance -le 55) {
        $darkSamples++
      }
      $bucket = "{0}:{1}:{2}" -f (
        [Math]::Floor($color.R / 16)
      ), (
        [Math]::Floor($color.G / 16)
      ), (
        [Math]::Floor($color.B / 16)
      )
      $colorBuckets[$bucket] = $true
      $samples++
    }
  }

  [pscustomobject]@{
    Samples = $samples
    DistinctColorBuckets = $colorBuckets.Count
    BrightSamples = $brightSamples
    DarkSamples = $darkSamples
    LuminanceRange = $maximumLuminance - $minimumLuminance
  }
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
  "denote-renderer-smoke-" + [guid]::NewGuid().ToString("N")
)
$oldAppData = $env:APPDATA
$oldLocalAppData = $env:LOCALAPPDATA
$oldWebViewData = $env:WEBVIEW2_USER_DATA_FOLDER
$process = $null
$window = $null
$metrics = [ordered]@{
  appPath = $resolvedApp
  processId = $null
  windowFound = $false
  width = 0
  height = 0
  samples = 0
  distinctColorBuckets = 0
  brightSamples = 0
  darkSamples = 0
  luminanceRange = 0
  rendered = $false
  exitedAfterClose = $false
  error = $null
}

try {
  $appData = Join-Path $temporaryRoot "Roaming"
  $localAppData = Join-Path $temporaryRoot "Local"
  $webViewData = Join-Path $temporaryRoot "WebView2"
  New-Item -ItemType Directory -Force -Path $appData, $localAppData, $webViewData |
    Out-Null
  $env:APPDATA = $appData
  $env:LOCALAPPDATA = $localAppData
  $env:WEBVIEW2_USER_DATA_FOLDER = $webViewData

  $process = Start-Process `
    -FilePath $resolvedApp `
    -WorkingDirectory ([System.IO.Path]::GetDirectoryName($resolvedApp)) `
    -PassThru
  $metrics.processId = $process.Id

  $windowDeadline = [DateTime]::UtcNow.AddSeconds($RenderTimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 200
    $process.Refresh()
    if ($process.HasExited) {
      throw "Denote exited before creating a window with code $($process.ExitCode)."
    }
    $window = [DenoteSmokeNative]::FindLargestVisibleWindow($process.Id)
  } while (
    $window.Handle -eq [IntPtr]::Zero -and
    [DateTime]::UtcNow -lt $windowDeadline
  )
  if ($window.Handle -eq [IntPtr]::Zero) {
    throw "Denote did not create a visible window before the timeout."
  }
  $metrics.windowFound = $true

  $workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $outerWidth = [Math]::Min(1000, $workingArea.Width - 20)
  $outerHeight = [Math]::Min(700, $workingArea.Height - 20)
  [DenoteSmokeNative]::ShowWindow($window.Handle, 9) | Out-Null
  [DenoteSmokeNative]::SetWindowPos(
    $window.Handle,
    [IntPtr]::Zero,
    $workingArea.Left + 10,
    $workingArea.Top + 10,
    $outerWidth,
    $outerHeight,
    0x0004 -bor 0x0040
  ) | Out-Null
  [DenoteSmokeNative]::SetForegroundWindow($window.Handle) | Out-Null

  $rendered = $false
  $analysis = [pscustomobject]@{
    Samples = 0
    DistinctColorBuckets = 0
    BrightSamples = 0
    DarkSamples = 0
    LuminanceRange = 0
  }
  do {
    Start-Sleep -Seconds 2
    $process.Refresh()
    if ($process.HasExited) {
      throw "Denote exited before rendering with code $($process.ExitCode)."
    }
    $window = [DenoteSmokeNative]::GetWindowInfo($window.Handle)
    if ($window.Width -le 0 -or $window.Height -le 0) {
      continue
    }

    $bitmap = [System.Drawing.Bitmap]::new(
      $window.Width,
      $window.Height,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen(
        $window.X,
        $window.Y,
        0,
        0,
        [System.Drawing.Size]::new($window.Width, $window.Height),
        [System.Drawing.CopyPixelOperation]::SourceCopy
      )
      $bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
      $analysis = Measure-RenderedFrame $bitmap
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }

    $metrics.width = $window.Width
    $metrics.height = $window.Height
    $metrics.samples = $analysis.Samples
    $metrics.distinctColorBuckets = $analysis.DistinctColorBuckets
    $metrics.brightSamples = $analysis.BrightSamples
    $metrics.darkSamples = $analysis.DarkSamples
    $metrics.luminanceRange = $analysis.LuminanceRange
    $rendered = (
      $analysis.DistinctColorBuckets -ge 12 -and
      $analysis.BrightSamples -ge 12 -and
      $analysis.DarkSamples -ge [Math]::Floor($analysis.Samples / 2) -and
      $analysis.LuminanceRange -ge 70
    )
  } while (-not $rendered -and [DateTime]::UtcNow -lt $windowDeadline)

  $metrics.rendered = $rendered
  if (-not $rendered) {
    throw (
      "Denote remained visually blank: " +
      "$($analysis.DistinctColorBuckets) color buckets, " +
      "$($analysis.BrightSamples) bright samples, " +
      "$($analysis.DarkSamples) dark samples, " +
      "$($analysis.LuminanceRange) luminance range."
    )
  }

  [DenoteSmokeNative]::PostMessage(
    $window.Handle,
    0x0010,
    [IntPtr]::Zero,
    [IntPtr]::Zero
  ) | Out-Null
  if (-not $process.WaitForExit($ExitTimeoutSeconds * 1000)) {
    throw "Denote kept running after its last window was closed."
  }
  $metrics.exitedAfterClose = $true
  Write-Host "Windows renderer smoke test passed."
} catch {
  $metrics.error = $_.Exception.ToString()
  throw
} finally {
  $metrics | ConvertTo-Json | Set-Content -Path $metricsPath -Encoding UTF8
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  $env:APPDATA = $oldAppData
  $env:LOCALAPPDATA = $oldLocalAppData
  if ($null -eq $oldWebViewData) {
    Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
  } else {
    $env:WEBVIEW2_USER_DATA_FOLDER = $oldWebViewData
  }
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
