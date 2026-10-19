"use client";

import UiModeSettings from "../../components/UiModeSettings";
import KorymbLlmAdminPage from "../admin/korymb-llm/page";

export default function ConfigurationPage() {
  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-4xl px-4 pt-6 sm:px-6">
        <UiModeSettings />
      </div>
      <KorymbLlmAdminPage />
    </div>
  );
}
