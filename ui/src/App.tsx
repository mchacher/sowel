import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { DevicesPage } from "./pages/DevicesPage";
import { DeviceDetailPage } from "./pages/DeviceDetailPage";
import { ZonesPage } from "./pages/ZonesPage";
import { ZoneDetailPage } from "./pages/ZoneDetailPage";
import { EquipmentsPage } from "./pages/EquipmentsPage";
import { EquipmentDetailPage } from "./pages/EquipmentDetailPage";
import { MaisonPage } from "./pages/MaisonPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {/* Maison — primary daily view */}
          <Route path="/maison" element={<MaisonPage />} />
          <Route path="/maison/:zoneId" element={<MaisonPage />} />

          {/* Settings pages */}
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:id" element={<DeviceDetailPage />} />
          <Route path="/equipments" element={<EquipmentsPage />} />
          <Route path="/equipments/:id" element={<EquipmentDetailPage />} />
          <Route path="/zones" element={<ZonesPage />} />
          <Route path="/zones/:id" element={<ZoneDetailPage />} />

          {/* Default redirect to Maison */}
          <Route path="*" element={<Navigate to="/maison" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
