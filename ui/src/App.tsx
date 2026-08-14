import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AdminRoute } from "./components/auth/AdminRoute";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { DevicesPage } from "./pages/DevicesPage";
import { DeviceDetailPage } from "./pages/DeviceDetailPage";
import { ZonesPage } from "./pages/ZonesPage";
import { ZoneDetailPage } from "./pages/ZoneDetailPage";
import { EquipmentsPage } from "./pages/EquipmentsPage";
import { EquipmentDetailPage } from "./pages/EquipmentDetailPage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { PluginsPage } from "./pages/PluginsPage";
import { ModesPage } from "./pages/ModesPage";
import { ModeDetailPage } from "./pages/ModeDetailPage";
import { CalendarPage } from "./pages/CalendarPage";
import { LogsPage } from "./pages/LogsPage";
import { BackupPage } from "./pages/BackupPage";
import { AnalysePage } from "./pages/AnalysePage";
import { MqttPublishersPage } from "./pages/MqttPublishersPage";
import { NotificationPublishersPage } from "./pages/NotificationPublishersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { EnergyPage } from "./components/energy/EnergyPage";
import { ProductionPage } from "./components/energy/ProductionPage";
import { LiveEnergyPage } from "./components/energy/LiveEnergyPage";

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
          <Route path="/devices" element={<AdminRoute><DevicesPage /></AdminRoute>} />
          <Route path="/devices/:id" element={<AdminRoute><DeviceDetailPage /></AdminRoute>} />
          <Route path="/equipments" element={<EquipmentsPage />} />
          <Route path="/equipments/:id" element={<EquipmentDetailPage />} />
          <Route path="/zones" element={<ZonesPage />} />
          <Route path="/zones/:id" element={<ZoneDetailPage />} />
          <Route path="/modes" element={<ModesPage />} />
          <Route path="/modes/:id" element={<ModeDetailPage />} />
          <Route path="/calendar" element={<AdminRoute><CalendarPage /></AdminRoute>} />
          <Route path="/energy" element={<Navigate to="/energy/live" replace />} />
          <Route path="/energy/live" element={<LiveEnergyPage />} />
          <Route path="/energy/consumption" element={<EnergyPage />} />
          <Route path="/energy/production" element={<ProductionPage />} />
          <Route path="/analyse" element={<AnalysePage />} />
          <Route path="/analyse/:chartId" element={<AnalysePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/integrations" element={<AdminRoute><IntegrationsPage /></AdminRoute>} />
          <Route path="/plugins" element={<AdminRoute><PluginsPage /></AdminRoute>} />
          <Route path="/mqtt-publishers" element={<AdminRoute><MqttPublishersPage /></AdminRoute>} />
          <Route path="/notification-publishers" element={<AdminRoute><NotificationPublishersPage /></AdminRoute>} />
          <Route path="/logs" element={<AdminRoute><LogsPage /></AdminRoute>} />
          <Route path="/backup" element={<AdminRoute><BackupPage /></AdminRoute>} />

          {/* Default redirect to Dashboard */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
