"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Lien Aide sur un message d'erreur, avec la page courante pour le formulaire. */
export default function ErrorHelpLink() {
  const pathname = usePathname() || "";
  const href = pathname ? `/aide?page=${encodeURIComponent(pathname)}` : "/aide";
  return (
    <Link href={href} className="mt-2 inline-block text-sm font-bold underline">
      Aide
    </Link>
  );
}
