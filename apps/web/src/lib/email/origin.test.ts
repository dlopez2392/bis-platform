import { describe, it, expect, vi } from "vitest";
import { originFrom, configuredOrigin } from "./origin";

describe("originFrom", () => {
  it("builds an absolute origin from the forwarded proto and host", () => {
    expect(originFrom(new Headers({
      host: "bis-platform-six.vercel.app", "x-forwarded-proto": "https",
    }))).toBe("https://bis-platform-six.vercel.app");
  });

  // A custom domain later needs no code change and no env var: the Host header
  // is whatever the visitor actually reached.
  it("follows whatever host the request arrived on", () => {
    expect(originFrom(new Headers({ host: "crm.rioroofing.com", "x-forwarded-proto": "https" })))
      .toBe("https://crm.rioroofing.com");
  });

  it("assumes https when no proto header is present", () => {
    expect(originFrom(new Headers({ host: "example.com" }))).toBe("https://example.com");
  });

  // A proxy chain sends a comma-separated list. Taking the whole string would
  // produce "https,http://host" — a URL that resolves nowhere, inside an email
  // nobody can test before it is sent.
  it("takes the first value when the proto header is a list", () => {
    expect(originFrom(new Headers({ host: "example.com", "x-forwarded-proto": "https,http" })))
      .toBe("https://example.com");
  });

  // No host means no link. The caller omits the button entirely rather than
  // emitting a relative path — which is the exact defect this work removes, and
  // it must not come back through the error path.
  it("returns null when there is no host to build on", () => {
    expect(originFrom(new Headers())).toBeNull();
  });

  // 2026-08-27 reversal (see the doc comment above originFrom): APP_ORIGIN now
  // wins over the Host header whenever it's set. The Host header IS correct by
  // construction for a browser request, but a cron tick or webhook callback has
  // no browser behind it — req.url there is the deployment's own vercel.app
  // URL, exactly the link/sender mismatch Gmail silently discarded mail over.
  it("prefers APP_ORIGIN over the Host header", () => {
    vi.stubEnv("APP_ORIGIN", "https://app.bis-rgv.com");
    expect(originFrom(new Headers({ host: "bis-platform-six.vercel.app" })))
      .toBe("https://app.bis-rgv.com");
    vi.unstubAllEnvs();
  });

  it("still derives from Host when APP_ORIGIN is unset", () => {
    expect(originFrom(new Headers({ host: "x.example" }))).toBe("https://x.example");
  });
});

describe("configuredOrigin", () => {
  it("reads APP_ORIGIN, trims whitespace, and strips trailing slashes", () => {
    expect(configuredOrigin({ APP_ORIGIN: " https://app.bis-rgv.com/ " } as unknown as NodeJS.ProcessEnv))
      .toBe("https://app.bis-rgv.com");
  });

  it("returns null when APP_ORIGIN is unset", () => {
    expect(configuredOrigin({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("returns null when APP_ORIGIN is set but blank", () => {
    expect(configuredOrigin({ APP_ORIGIN: "  " } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});
