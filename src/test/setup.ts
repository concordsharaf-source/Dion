import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { webcrypto } from 'node:crypto'
import { afterEach } from 'vitest'

// jsdom لا يوفّر WebCrypto — نستخدم WebCrypto في Node
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  })
}

// بعض إصدارات jsdom تفتقد matchMedia
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

if (!globalThis.BroadcastChannel) {
  class FakeBroadcastChannel {
    name: string
    onmessage: ((ev: MessageEvent) => void) | null = null
    constructor(name: string) {
      this.name = name
    }
    postMessage() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  // @ts-expect-error تعريف مبسّط للاختبارات
  globalThis.BroadcastChannel = FakeBroadcastChannel
}

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
