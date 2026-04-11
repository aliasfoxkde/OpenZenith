"use client";

import { type ReactNode } from "react";
import { ToastProvider } from "./Toast";

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
