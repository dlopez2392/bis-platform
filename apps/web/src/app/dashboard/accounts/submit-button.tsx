"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? m["common.saving"] : children}
    </Button>
  );
}
