import AppNav from "./AppNav";
import AppStatusZone from "./AppStatusZone";
import RuntimeHeader from "./RuntimeHeader";
import NotificationBell from "./director/NotificationBell";
import AuthBar from "./AuthBar";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="app-header-bar">
        <div className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-5 lg:px-6 xl:px-8">
          <div className="min-w-0 flex-1">
            <p className="app-brand">Korymb</p>
            <RuntimeHeader />
          </div>
          <AuthBar />
          <NotificationBell />
          <AppNav />
        </div>
        <div className="app-status-strip">
          <div className="w-full min-w-0 px-3 py-2.5 sm:px-5 sm:py-3 lg:px-6 xl:px-8">
            <AppStatusZone />
          </div>
        </div>
      </header>
      <main className="w-full min-w-0 px-3 py-4 pb-safe sm:px-5 sm:py-6 lg:px-6 lg:py-8 xl:px-8">{children}</main>
    </>
  );
}
