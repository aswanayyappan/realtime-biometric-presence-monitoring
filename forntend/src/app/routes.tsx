import { createBrowserRouter, Outlet } from "react-router";
import { SidebarNavigation, SidebarButton, Avatar, ThemeProvider } from "@figma/astraui";
import { Home, List, Activity, Clock, Shield, Settings } from "lucide-react";
import Dashboard from "./components/Dashboard";
import PhoneCamera from "./components/PhoneCamera";

function Root() {
  return (
    <ThemeProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
        <SidebarNavigation
          footer={
            <>
              <SidebarButton icon={<Settings className="size-full" strokeWidth={1.5} />} />
              <Avatar type="image" src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop" size="medium" shape="circle" />
            </>
          }
        >
          <SidebarButton icon={<Home className="size-full" strokeWidth={1.5} />} active />
          <SidebarButton icon={<List className="size-full" strokeWidth={1.5} />} />
          <SidebarButton icon={<Activity className="size-full" strokeWidth={1.5} />} />
          <SidebarButton icon={<Clock className="size-full" strokeWidth={1.5} />} />
          <SidebarButton icon={<Shield className="size-full" strokeWidth={1.5} />} />
        </SidebarNavigation>
        
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </ThemeProvider>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Dashboard },
      { path: "*", Component: Dashboard },
    ],
  },
  {
    // Standalone phone camera page — no sidebar, fullscreen mobile UI
    path: "/camera",
    Component: PhoneCamera,
  },
]);