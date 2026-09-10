"use client";

import { useParams } from "next/navigation";
import AccountLoginFormSuspense from "../../../../components/auth/AccountLoginForm";

export default function ParticipantLoginPage() {
  const { slug } = useParams<{ slug: string }>();
  return <AccountLoginFormSuspense audience="subscriber" workspaceSlug={slug || ""} />;
}
