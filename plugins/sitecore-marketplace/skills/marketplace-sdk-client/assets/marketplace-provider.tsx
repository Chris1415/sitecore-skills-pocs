'use client';

// MarketplaceProvider — the scaffold's canonical SDK init pattern.
//
// This is the shape the Marketplace shadcn quickstart ships at
// components/providers/marketplace.tsx. Drop into a React app to wire up
// ClientSDK.init() with the XMC module, expose the client + applicationContext
// via Context, and render children only after both resolve.
//
// Wrap the app at app/layout.tsx:
//   <MarketplaceProvider>{children}</MarketplaceProvider>
//
// Consumers call useMarketplaceClient() / useAppContext() — no prop drilling.
// Both hooks throw if used outside the Provider, which is what you want.
//
// Extend `modules: [XMC]` to `[XMC, AI]` if the app uses the AI skills package.
// Add ClientSDK.init `origin` and `timeout` options if you need them.

import {
  type ApplicationContext,
  ClientSDK,
} from '@sitecore-marketplace-sdk/client';
import { XMC } from '@sitecore-marketplace-sdk/xmc';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

const ClientSDKContext = createContext<ClientSDK | null>(null);
const AppContextContext = createContext<ApplicationContext | null>(null);

export const MarketplaceProvider = ({ children }: { children: ReactNode }) => {
  const [client, setClient] = useState<ClientSDK | null>(null);
  const [appContext, setAppContext] = useState<ApplicationContext | null>(null);

  useEffect(() => {
    ClientSDK.init({
      target: window.parent,
      modules: [XMC],
    }).then(setClient);
  }, []);

  useEffect(() => {
    client?.query('application.context').then((res) => {
      if (res?.data) setAppContext(res.data);
    });
  }, [client]);

  if (!client || !appContext) return null;

  return (
    <ClientSDKContext.Provider value={client}>
      <AppContextContext.Provider value={appContext}>
        {children}
      </AppContextContext.Provider>
    </ClientSDKContext.Provider>
  );
};

export const useMarketplaceClient = () => {
  const ctx = useContext(ClientSDKContext);
  if (!ctx) throw new Error('useMarketplaceClient must be used within MarketplaceProvider');
  return ctx;
};

export const useAppContext = () => {
  const ctx = useContext(AppContextContext);
  if (!ctx) throw new Error('useAppContext must be used within MarketplaceProvider');
  return ctx;
};
