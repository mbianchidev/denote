interface WelcomePageTarget {
  effectivePath: string | null;
  hasTabSession: boolean;
}

export function welcomePageTarget(
  welcomePage: WelcomePageTarget,
  hasPendingWorkspaceFile: boolean,
): string | null {
  if (hasPendingWorkspaceFile || welcomePage.hasTabSession) {
    return null;
  }
  return welcomePage.effectivePath;
}
