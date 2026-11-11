import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AdminRoute } from "./components/auth/AdminRoute";
import { lazyPage } from "./lib/lazy-page";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { HomePage } from "./pages/HomePage";
import { DashboardPage } from "./pages/DashboardPage";

// Pages off the first screen load on first visit (#1187): the landing pages
// (Dashboard, Home) and the public ones stay in the entry chunk.
const DevicesPage = lazyPage(() => import("./pages/DevicesPage"), "DevicesPage");
const DeviceDetailPage = lazyPage(() => import("./pages/DeviceDetailPage"), "DeviceDetailPage");
const ZonesPage = lazyPage(() => import("./pages/ZonesPage"), "ZonesPage");
const ZoneDetailPage = lazyPage(() => import("./pages/ZoneDetailPage"), "ZoneDetailPage");
const EquipmentsPage = lazyPage(() => import("./pages/EquipmentsPage"), "EquipmentsPage");
const EquipmentDetailPage = lazyPage(
  () => import("./pages/EquipmentDetailPage"),
  "EquipmentDetailPage",
);
const SettingsPage = lazyPage(() => import("./pages/SettingsPage"), "SettingsPage");
const IntegrationsPage = lazyPage(() => import("./pages/IntegrationsPage"), "IntegrationsPage");
const PluginsPage = lazyPage(() => import("./pages/PluginsPage"), "PluginsPage");
const ModesPage = lazyPage(() => import("./pages/ModesPage"), "ModesPage");
const ModeDetailPage = lazyPage(() => import("./pages/ModeDetailPage"), "ModeDetailPage");
const CalendarPage = lazyPage(() => import("./pages/CalendarPage"), "CalendarPage");
const LogsPage = lazyPage(() => import("./pages/LogsPage"), "LogsPage");
const BackupPage = lazyPage(() => import("./pages/BackupPage"), "BackupPage");
const AnalysePage = lazyPage(() => import("./pages/AnalysePage"), "AnalysePage");
const MqttPublishersPage = lazyPage(
  () => import("./pages/MqttPublishersPage"),
  "MqttPublishersPage",
);
const NotificationPublishersPage = lazyPage(
  () => import("./pages/NotificationPublishersPage"),
  "NotificationPublishersPage",
);
const SharedAccessPage = lazyPage(() => import("./pages/SharedAccessPage"), "SharedAccessPage");
const EnergyPage = lazyPage(() => import("./components/energy/EnergyPage"), "EnergyPage");
const ProductionPage = lazyPage(
  () => import("./components/energy/ProductionPage"),
  "ProductionPage",
);
const LiveEnergyPage = lazyPage(
  () => import("./components/energy/LiveEnergyPage"),
  "LiveEnergyPage",
);
const BilanPage = lazyPage(() => import("./components/energy/BilanPage"), "BilanPage");

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />

          {/* Protected routes — wrapped in AppLayout */}
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            {/* Dashboard — default landing page */}
            <Route path="/dashboard" element={<DashboardPage />} />

            {/* Maison — zone-based view */}
            <Route path="/home" element={<HomePage />} />
            <Route path="/home/:zoneId" element={<HomePage />} />

            {/* Settings pages */}
            {/* Admin-only config pages are wrapped in AdminRoute (standard users
              are redirected to the dashboard). Equipments/zones/modes stay
              reachable for consultation; their mutating controls are gated
              per-button instead, since standard users can still view them. */}
            <Route
              path="/devices"
              element={
                <AdminRoute>
                  <DevicesPage />
                </AdminRoute>
              }
            />
            <Route
              path="/devices/:id"
              element={
                <AdminRoute>
                  <DeviceDetailPage />
                </AdminRoute>
              }
            />
            <Route path="/equipments" element={<EquipmentsPage />} />
            <Route path="/equipments/:id" element={<EquipmentDetailPage />} />
            <Route path="/zones" element={<ZonesPage />} />
            <Route path="/zones/:id" element={<ZoneDetailPage />} />
            <Route path="/modes" element={<ModesPage />} />
            <Route path="/modes/:id" element={<ModeDetailPage />} />
            <Route
              path="/calendar"
              element={
                <AdminRoute>
                  <CalendarPage />
                </AdminRoute>
              }
            />
            <Route path="/energy" element={<Navigate to="/energy/live" replace />} />
            <Route path="/energy/live" element={<LiveEnergyPage />} />
            <Route path="/energy/bilan" element={<BilanPage />} />
            <Route path="/energy/consumption" element={<EnergyPage />} />
            <Route path="/energy/production" element={<ProductionPage />} />
            <Route path="/analyse" element={<AnalysePage />} />
            <Route path="/analyse/:chartId" element={<AnalysePage />} />
            <Route
              path="/shared-access"
              element={
                <AdminRoute>
                  <SharedAccessPage />
                </AdminRoute>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="/integrations"
              element={
                <AdminRoute>
                  <IntegrationsPage />
                </AdminRoute>
              }
            />
            <Route
              path="/plugins"
              element={
                <AdminRoute>
                  <PluginsPage />
                </AdminRoute>
              }
            />
            <Route
              path="/mqtt-publishers"
              element={
                <AdminRoute>
                  <MqttPublishersPage />
                </AdminRoute>
              }
            />
            <Route
              path="/notification-publishers"
              element={
                <AdminRoute>
                  <NotificationPublishersPage />
                </AdminRoute>
              }
            />
            <Route
              path="/logs"
              element={
                <AdminRoute>
                  <LogsPage />
                </AdminRoute>
              }
            />
            <Route
              path="/backup"
              element={
                <AdminRoute>
                  <BackupPage />
                </AdminRoute>
              }
            />

            {/* Default redirect to Dashboard */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
