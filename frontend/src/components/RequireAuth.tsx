import React from "react";

/** Auth removed per spec — no sign-in, no sign-up, no account system. */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
