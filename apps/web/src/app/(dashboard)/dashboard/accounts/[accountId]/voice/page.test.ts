import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VoiceProfileRow } from "@bis/db";
import { defaultTextbackBody } from "@/lib/voice/textback-body";

/**
 * What is under test here is ONE thing: which company name this page hands
 * the text-back preview.
 *
 * The defect: the page read `accounts.name` — the agency's INTERNAL label
 * ("Rio Roofing — trial") — while the sender (lib/voice/finish-call.ts)
 * signs the actual text with the customer-facing brand name. The operator
 * approved one message and a different one went to a stranger's phone, with
 * the internal label's em dash silently doubling the segment count the
 * counter under the textarea exists to show.
 *
 * `VoiceSettings` is stubbed rather than rendered: the assertion is about the
 * value the server component resolves, and rendering the real form would drag
 * Radix, sonner and the segment counter into a test that has nothing to say
 * about any of them.
 */
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));

const dbFixture = vi.hoisted(() => ({ name: "Rio Roofing — trial", brandName: null as string | null }));
const serviceDbMock = vi.hoisted(() => ({ getBranding: vi.fn(), getVoiceProfile: vi.fn() }));

vi.mock("@bis/db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      if (table === "phone_numbers") {
        return {
          select: () => ({
            eq: () => ({ order: async () => ({ data: [], error: null }) }),
          }),
        };
      }
      // accounts
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { name: dbFixture.name }, error: null }) }),
        }),
      };
    },
  }),
  getVoiceProfile: (...a: unknown[]) => serviceDbMock.getVoiceProfile(...a),
  getBranding: (...a: unknown[]) => serviceDbMock.getBranding(...a),
}));

// "use server" modules cannot be imported into a vitest render.
vi.mock("./actions", () => ({
  saveVoiceProfileAction: async () => ({ ok: true }),
  assignNumberAction: async () => ({ ok: true }),
  setNumberStatusAction: async () => ({ ok: true }),
}));

const captured = vi.hoisted(() => ({ props: null as { brandName?: string } | null }));
vi.mock("./voice-settings", () => ({
  VoiceSettings: (props: { brandName: string }) => {
    captured.props = props;
    return null;
  },
}));

const { default: VoicePage } = await import("./page");

const PROFILE: VoiceProfileRow = {
  id: "vp1", account_id: "a1", persona_name: "Sofía",
  greeting_en: "", greeting_es: "", facts: "", services: "",
  languages: "both", booking_enabled: true, after_hours: "hours_then_message",
  enabled: true, textback_enabled: true, textback_body: "",
};

async function render() {
  captured.props = null;
  const el = await VoicePage({
    params: Promise.resolve({ accountId: "a1" }),
    searchParams: Promise.resolve({}),
  });
  renderToStaticMarkup(el);
  return captured.props!;
}

beforeEach(() => {
  dbFixture.name = "Rio Roofing — trial";
  dbFixture.brandName = null;
  serviceDbMock.getVoiceProfile.mockReset().mockResolvedValue(PROFILE);
  serviceDbMock.getBranding.mockReset().mockImplementation(async () => ({
    brandName: dbFixture.brandName, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
  }));
});

describe("voice settings page — text-back preview name", () => {
  it("previews the BRAND name, not the agency's internal accounts.name label", async () => {
    dbFixture.brandName = "Rio Roofing";
    const props = await render();
    expect(props.brandName).toBe("Rio Roofing");
    // The exact string the sender would build, so a divergence between the
    // two resolvers shows up here rather than on a customer's phone.
    expect(defaultTextbackBody(props.brandName!, "en")).toBe(defaultTextbackBody("Rio Roofing", "en"));
    expect(defaultTextbackBody(props.brandName!, "en")).not.toContain("trial");
  });

  it("falls back to the account name when the company has set no brand name", async () => {
    dbFixture.name = "Rio Roofing";
    const props = await render();
    expect(props.brandName).toBe("Rio Roofing");
  });

  it("a failing branding read degrades to a blank name, never a 500", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    serviceDbMock.getBranding.mockRejectedValue(new Error("db down"));
    const props = await render();
    errSpy.mockRestore();
    // Blank is the one input defaultTextbackBody handles by dropping the
    // identifying clause rather than inventing a placeholder noun.
    expect(props.brandName).toBe("");
  });
});
