"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { GlobalLoaderOverlay } from "./global-loader-overlay";

export type GlobalLoadingState = {
  label: string;
  description?: string;
};

type GlobalLoadingContextValue = {
  showLoading: (label: string, description?: string) => number;
  hideLoading: (requestId: number) => void;
};

const GlobalLoadingContext = createContext<GlobalLoadingContextValue | null>(null);

export function GlobalLoadingProvider({ children }: { children: React.ReactNode }) {
  const nextId = useRef(0);
  const requests = useRef(new Map<number, GlobalLoadingState>());
  const [current, setCurrent] = useState<GlobalLoadingState | null>(null);

  const showLoading = useCallback((label: string, description?: string) => {
    const requestId = ++nextId.current;
    const request = { label, description };
    requests.current.set(requestId, request);
    setCurrent(request);
    return requestId;
  }, []);

  const hideLoading = useCallback((requestId: number) => {
    requests.current.delete(requestId);
    const remaining = Array.from(requests.current.values());
    setCurrent(remaining.at(-1) ?? null);
  }, []);

  const value = useMemo(
    () => ({ showLoading, hideLoading }),
    [hideLoading, showLoading],
  );

  return (
    <GlobalLoadingContext.Provider value={value}>
      {children}
      <GlobalLoaderOverlay state={current} />
    </GlobalLoadingContext.Provider>
  );
}

export function useGlobalLoading() {
  const context = useContext(GlobalLoadingContext);

  if (!context) {
    throw new Error("useGlobalLoading debe utilizarse dentro de GlobalLoadingProvider.");
  }

  return context;
}

export function useGlobalPending(
  pending: boolean,
  label: string,
  description?: string,
) {
  const { showLoading, hideLoading } = useGlobalLoading();
  const requestId = useRef<number | null>(null);

  useEffect(() => {
    if (pending && requestId.current === null) {
      requestId.current = showLoading(label, description);
    }

    if (!pending && requestId.current !== null) {
      hideLoading(requestId.current);
      requestId.current = null;
    }

    return () => {
      if (requestId.current !== null) {
        hideLoading(requestId.current);
        requestId.current = null;
      }
    };
  }, [description, hideLoading, label, pending, showLoading]);
}
