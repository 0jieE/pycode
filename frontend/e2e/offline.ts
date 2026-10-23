import type { BrowserContext, Page } from '@playwright/test'

/**
 * This system runs on the school LAN with no internet. The built app must therefore never ask any
 * host other than its own for anything: no CDN, no Google Fonts, no analytics, no remote images.
 * `watchOffline` records every request of a browser context (page loads, scripts, fonts, images,
 * fetch calls and WebSockets) so a test can assert that none went anywhere else.
 */
export interface OfflineWatch {
  /** Requests to a host other than the app's own. Must stay empty. */
  foreign: string[]
  /** How many requests were seen in total: proof that the watcher was really listening. */
  seen: () => number
}

// Not network requests to a host: these stay inside the page.
const LOCAL_SCHEMES = ['data:', 'blob:', 'about:']

export function watchOffline(context: BrowserContext, appUrl: string): OfflineWatch {
  const ownHost = new URL(appUrl).host
  const foreign: string[] = []
  let total = 0

  const check = (url: string) => {
    total++
    if (LOCAL_SCHEMES.some((s) => url.startsWith(s))) return
    // Compare hosts, not schemes: the app's own WebSockets are ws://same-host.
    if (new URL(url).host !== ownHost) foreign.push(url)
  }

  const watchPage = (page: Page) => page.on('websocket', (ws) => check(ws.url()))
  context.pages().forEach(watchPage)
  context.on('page', watchPage)
  context.on('request', (request) => check(request.url()))

  return { foreign, seen: () => total }
}
