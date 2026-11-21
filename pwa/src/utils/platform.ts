// Android, whose soft keyboards edit text through IME compositions instead of
// sending keys (see utils/android-input.ts)
export function isAndroid(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return /android/i.test(
    `${nav.userAgentData?.platform || ''} ${navigator.userAgent}`,
  )
}

// Apple platforms (macOS, iPadOS, iOS): Cmd takes the place of Ctrl in
// shortcuts, and Ctrl+Shift+C stays a terminal key
export function isApplePlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform || navigator.platform || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}
