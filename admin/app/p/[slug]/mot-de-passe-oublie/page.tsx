"use client";

import { useParams } from "next/navigation";
import ForgotPasswordForm from "../../../../components/auth/ForgotPasswordForm";

export default function ParticipantForgotPasswordPage() {
  const { slug } = useParams<{ slug: string }>();
  return <ForgotPasswordForm audience="subscriber" workspaceSlug={slug || ""} />;
}
