export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function withBasePath(assetPath: string): string {
  if (!BASE_PATH) return assetPath;
  if (!assetPath.startsWith('/')) {
    return `${BASE_PATH}/${assetPath}`;
  }
  return `${BASE_PATH}${assetPath}`;
}
