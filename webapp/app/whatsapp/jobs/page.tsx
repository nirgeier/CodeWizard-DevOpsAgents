import { redirect } from "next/navigation";

/**
 * The WhatsApp-scoped jobs view folded into the general one.
 *
 * Jobs from every source now live at /jobs with a source filter, so this route
 * stays only to keep existing links and bookmarks working - it lands on the
 * same table, pre-narrowed to WhatsApp.
 */
export default function WhatsAppJobsPage() {
  redirect("/jobs?source=whatsapp");
}
