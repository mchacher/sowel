import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
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
import { ModesPage } from "./pages/ModesPage";
import { ModeDetailPage } from "./pages/ModeDetailPage";
import { CalendarPage } from "./pages/CalendarPage";
import { LogsPage } from "./pages/LogsPage";
import { BackupPage } from "./pages/BackupPage";
import { AnalysePage } from "./pages/AnalysePage";
import { MqttPublishersPage } from "./pages/MqttPublishersPage";
import { NotificationPublishersPage } from "./pages/NotificationPublishersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { QrLoginPage } from "./pages/QrLoginPage";
import { EnergyPage } from "./components/energy/EnergyPage";

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/qr-login" element={<QrLoginPage />} />

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
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:id" element={<DeviceDetailPage />} />
          <Route path="/equipments" element={<EquipmentsPage />} />
          <Route path="/equipments/:id" element={<EquipmentDetailPage />} />
          <Route path="/zones" element={<ZonesPage />} />
          <Route path="/zones/:id" element={<ZoneDetailPage />} />
          <Route path="/modes" element={<ModesPage />} />
          <Route path="/modes/:id" element={<ModeDetailPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/energy" element={<Navigate to="/energy/consumption" replace />} />
          <Route path="/energy/consumption" element={<EnergyPage />} />
          <Route path="/analyse" element={<AnalysePage />} />
          <Route path="/analyse/:chartId" element={<AnalysePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/integrations" element={<IntegrationsPage />} />
          <Route path="/mqtt-publishers" element={<MqttPublishersPage />} />
          <Route path="/notification-publishers" element={<NotificationPublishersPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/backup" element={<BackupPage />} />

          {/* Default redirect to Dashboard */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
