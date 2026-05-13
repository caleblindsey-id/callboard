// Validators for user-supplied Supabase Storage paths.
//
// Caller-side defense for two reasons:
//   1. An attacker with a valid auth session can POST any string they want
//      as `storage_path` — Storage RLS only guards the upload itself, not what
//      the API persists into the DB.
//   2. A signed URL on a `.svg` (or other browser-executed type) can be a
//      stored-XSS vector when rendered alongside trusted markup.

const ALLOWED_PHOTO_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
])

const MAX_PATH_LEN = 256

export type StoragePathError =
  | { ok: true }
  | { ok: false; error: string }

export function validatePhotoStoragePath(
  path: unknown,
  expectedPrefix: string,
): StoragePathError {
  if (typeof path !== 'string' || !path) {
    return { ok: false, error: 'Invalid photo path.' }
  }
  if (path.length > MAX_PATH_LEN) {
    return { ok: false, error: 'Photo path is too long.' }
  }
  if (path.includes('..') || path.includes('\\') || path.includes('\0')) {
    return { ok: false, error: 'Invalid photo path.' }
  }
  if (!path.startsWith(expectedPrefix)) {
    return { ok: false, error: 'Invalid photo path.' }
  }
  const lastDot = path.lastIndexOf('.')
  const ext = lastDot >= 0 ? path.slice(lastDot).toLowerCase() : ''
  if (!ALLOWED_PHOTO_EXTS.has(ext)) {
    return { ok: false, error: 'Invalid photo type.' }
  }
  return { ok: true }
}
