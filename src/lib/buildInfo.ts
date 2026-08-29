export interface BuildInfo {
  version: string;
  commitHash: string;
  dirty: boolean;
}

export const BUILD_INFO: BuildInfo = {
  version: __DENOTE_VERSION__,
  commitHash: __DENOTE_COMMIT_HASH__,
  dirty: __DENOTE_DIRTY_BUILD__,
};

export function shortCommitHash(commitHash: string): string {
  return commitHash.slice(0, 12);
}
