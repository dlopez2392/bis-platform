import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";

const RUN = Math.random().toString(36).slice(2, 10);
const SUB = `user_prefs_schema_${RUN}`;

async function seedUser(c: import("pg").Client): Promise<string> {
  return (await c.query<{ id: string }>(
    "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB])).rows[0]!.id;
}

describe("users.theme (0067)", () => {
  it.each(["light", "dark", "system"])("accepts %s (mutation: narrow the check to light/dark -> FAILS on system)", async (v) => {
    await withRollback(async (c) => {
      const id = await seedUser(c);
      const r = await c.query("update users set theme = $1 where id = $2", [v, id]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("accepts NULL, which means no choice", async () => {
    await withRollback(async (c) => {
      const id = await seedUser(c);
      const { rows } = await c.query<{ theme: string | null }>("select theme from users where id = $1", [id]);
      expect(rows[0]!.theme).toBeNull();
    });
  });

  it("rejects anything else (mutation: drop users_theme_check -> FAILS)", async () => {
    await withRollback(async (c) => {
      const id = await seedUser(c);
      await expect(c.query("update users set theme = 'blue' where id = $1", [id])).rejects.toThrow(/users_theme_check/);
    });
  });

  it("a client token cannot write it (mutation: grant update on public.users to authenticated -> FAILS)", async () => {
    await withRollback(async (c) => {
      const id = await seedUser(c);
      await actAs(c, { org_id: `org_prefs_${RUN}`, sub: SUB });
      await expect(c.query("update users set theme = 'dark' where id = $1", [id])).rejects.toThrow(/permission denied/);
    });
  });
});
