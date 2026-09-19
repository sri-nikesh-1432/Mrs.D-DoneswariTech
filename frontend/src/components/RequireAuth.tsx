import React from "react";
import { Navigate } from "react-router-dom";
import { getToken } from "../services/api";

/** Auth gate (spec §3 §63): unauthenticated users are redirected to sign-in. */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
