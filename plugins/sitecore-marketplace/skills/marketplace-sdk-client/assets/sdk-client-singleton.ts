'use client';

// SDK client singleton — module-level promise for non-React consumers.
//
// Use this when the SDK is consumed outside the React tree (library exports,
// utility modules, top-level scripts). Same init contract as the
// MarketplaceProvider pattern, different consumption shape.
//
// DO NOT mix this pattern with MarketplaceProvider in the same app —
// that creates two parallel init paths and risks duplicate handshakes.
//
// Dynamic import of ClientSDK + XMC ensures the SDK doesn't crash during SSR
// (it requires window.parent + postMessage, which only exist in the browser).
//
// Extend `modules: [XMC]` to `[XMC, AI]` if the app uses the AI skills package.

import type { ClientSDK as ClientSDKType } from '@sitecore-marketplace-sdk/client';

let sdkInstance: ClientSDKType | null = null;
let initPromise: Promise<ClientSDKType> | null = null;

export async function getSDKClient(): Promise<ClientSDKType> {
  if (sdkInstance) return sdkInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { ClientSDK } = await import('@sitecore-marketplace-sdk/client');
    const { XMC } = await import('@sitecore-marketplace-sdk/xmc');
    const client = await ClientSDK.init({
      target: window.parent,
      modules: [XMC],
    });
    sdkInstance = client;
    return client;
  })();

  return initPromise;
}
