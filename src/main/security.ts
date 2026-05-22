import { session } from 'electron'

const isDev = !!process.env.ELECTRON_RENDERER_URL

// Renderer never talks to external HTTP APIs directly — all network (Anthropic)
// happens in main. So the production CSP can stay strict (no remote connect-src).
// Dev needs ws/eval for Vite HMR + React Fast Refresh.
const CSP_PROD =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"

const CSP_DEV =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: wss: http: https:"

export function applySecurity(): void {
  const csp = isDev ? CSP_DEV : CSP_PROD
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  // Deny all renderer permission requests (camera, geolocation, etc.) by default.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })
}
