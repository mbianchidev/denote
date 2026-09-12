const WINDOWS_VERBATIM_UNC_PREFIX = /\\\\\?\\UNC\\/g;
const WINDOWS_VERBATIM_DRIVE_PREFIX = /\\\\\?\\(?=[A-Za-z]:[\\/])/g;

export function systemPathForDisplay(value: string): string {
  return value
    .replace(WINDOWS_VERBATIM_UNC_PREFIX, "\\\\")
    .replace(WINDOWS_VERBATIM_DRIVE_PREFIX, "");
}
