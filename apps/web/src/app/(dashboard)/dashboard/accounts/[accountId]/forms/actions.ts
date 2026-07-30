"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAgency } from "@/lib/auth";
import { serviceDb, createForm, updateForm, type FormField, type FormStatus } from "@bis/db";
import { m } from "@/lib/messages";

export async function createFormAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("name required");

  const { id } = await createForm(serviceDb(), accountId, {
    name,
    // A form with no fields cannot be published, so seed the three that every
    // lead form needs rather than opening an empty editor.
    fields: [
      { key: "first_name", kind: "core.first_name", label: "Name", required: true },
      { key: "email", kind: "core.email", label: "Email", required: true },
      { key: "message", kind: "message", label: "How can we help?", required: false },
    ],
  }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/forms`);
  redirect(`/dashboard/accounts/${accountId}/forms/${id}`);
}

export async function saveFormAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const formId = String(formData.get("formId") ?? "");
  if (!formId) throw new Error("formId required");

  // The editor posts the field list as JSON: it is an ordered array of objects,
  // which flat form fields cannot express without inventing an encoding.
  let fields: FormField[];
  try {
    fields = JSON.parse(String(formData.get("fields") ?? "[]")) as FormField[];
  } catch {
    throw new Error("fields must be valid JSON");
  }

  const status = String(formData.get("status") ?? "draft") as FormStatus;
  if (status === "published" && fields.length === 0) {
    throw new Error("a form needs at least one field before it can be published");
  }

  const notifyEmails = String(formData.get("notifyEmails") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);

  // A javascript: (or other non-http) redirect URL was a real security hole
  // closed at two other layers this milestone (the public form page and
  // embed.js both refuse to navigate to a non-http(s) URL). This write path
  // is the remaining place such a value could be stored at all, so it is
  // rejected here too rather than trusted because "it's just an input type".
  // The type="url" attribute on the editor's <Input> is a client-side hint
  // only and enforces nothing server-side.
  const redirectUrl = String(formData.get("redirectUrl") ?? "").trim();
  if (redirectUrl) {
    let scheme: string | null = null;
    try {
      scheme = new URL(redirectUrl).protocol;
    } catch {
      scheme = null;
    }
    if (scheme !== "http:" && scheme !== "https:") {
      throw new Error(m["forms.invalidRedirectUrl"]);
    }
  }

  await updateForm(serviceDb(), accountId, formId, {
    name: String(formData.get("name") ?? "").trim(),
    status,
    fields,
    theme: {
      accent: String(formData.get("accent") ?? "") || undefined,
      transparentBackground: formData.get("transparent") === "on",
      mode: "light",
    },
    success_mode: formData.get("successMode") === "redirect" ? "redirect" : "message",
    success_message: String(formData.get("successMessage") ?? "").trim() || null,
    redirect_url: redirectUrl || null,
    notify_emails: notifyEmails,
    locale_default: formData.get("locale") === "es" ? "es" : "en",
  }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/forms`);
  revalidatePath(`/dashboard/accounts/${accountId}/forms/${formId}`);
}
