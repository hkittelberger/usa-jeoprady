import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const Tv = lazy(() => import("./pages/Tv"));
const Admin = lazy(() => import("./pages/Admin"));
const Team = lazy(() => import("./pages/Team"));

const path = location.pathname.replace(/\/+$/, "");
const Page = path === "/tv" ? Tv : path === "/admin" ? Admin : Team;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
);
