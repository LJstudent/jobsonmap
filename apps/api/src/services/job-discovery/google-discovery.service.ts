export async function discoverByGoogle(): Promise<never> {
  throw new Error(
    'Google discovery is no longer part of the active jobs discovery flow',
  );
}
