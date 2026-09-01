export async function acquireWorkspaceLockAndDrainProjectMutations(
  acquireWorkspaceLock: () => Promise<void>,
  currentProjectMutationTail: () => Promise<void>,
): Promise<void> {
  await acquireWorkspaceLock();
  await currentProjectMutationTail();
}
