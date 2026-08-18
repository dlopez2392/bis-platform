import { describe, it, expect } from "vitest";
import { originFrom } from "./origin";

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
});
