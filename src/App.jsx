import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard, { MissionNouvellePage } from "./components/Dashboard";
import MissionCadrage from "./components/MissionCadrage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/mission" element={<Navigate to="/mission/guided" replace />} />
        <Route path="/mission/guided" element={<MissionCadrage />} />
        <Route path="/mission/nouvelle" element={<MissionNouvellePage />} />
      </Routes>
    </Layout>
  );
}
