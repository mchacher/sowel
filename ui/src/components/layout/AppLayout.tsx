import { Outlet } from "react-router-dom";
import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { ConnectionStatus } from "./ConnectionStatus";
import { useWebSocket } from "../../store/useWebSocket";
import { useDevices } from "../../store/useDevices";
import { useZones } from "../../store/useZones";
import { useEquipments } from "../../store/useEquipments";

export function AppLayout() {
  const connect = useWebSocket((s) => s.connect);
  const disconnect = useWebSocket((s) => s.disconnect);
  const fetchDevices = useDevices((s) => s.fetchDevices);
  const fetchZones = useZones((s) => s.fetchZones);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);

  useEffect(() => {
    fetchDevices();
    fetchZones();
    fetchEquipments();
    connect();
    return () => disconnect();
  }, [fetchDevices, fetchZones, fetchEquipments, connect, disconnect]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — hidden on mobile, shown on desktop */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between h-[60px] px-6 border-b border-border bg-surface/80 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            {/* Mobile logo */}
            <div className="flex md:hidden items-center gap-2">
              <div className="w-7 h-7 bg-primary rounded-[5px] flex items-center justify-center">
                <span className="text-white font-semibold text-xs">C</span>
              </div>
              <span className="font-semibold text-[15px] text-text">Corbel</span>
            </div>
          </div>
          <ConnectionStatus />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* Mobile bottom navigation */}
        <MobileNav />
      </div>
    </div>
  );
}

function MobileNav() {
  return (
    <nav className="flex md:hidden items-center justify-around h-[56px] border-t border-border bg-surface px-2">
      <MobileNavLink to="/maison" label="Maison" active />
      <MobileNavLink to="/devices" label="Devices" />
      <MobileNavLink to="/equipments" label="Equip." />
      <MobileNavLink to="/zones" label="Zones" />
    </nav>
  );
}

function MobileNavLink({
  label,
  active,
  disabled,
}: {
  to: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`
        flex flex-col items-center justify-center py-1 px-3 rounded-[6px]
        text-[11px] font-medium
        ${disabled ? "text-text-tertiary opacity-40" : ""}
        ${active ? "text-primary" : "text-text-secondary"}
      `}
    >
      <span className="text-[11px]">{label}</span>
    </div>
  );
}
