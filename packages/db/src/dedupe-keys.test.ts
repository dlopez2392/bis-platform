import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { nameFold, nameKey, phoneNational, phoneFamily, reasonStrength, reasonLabel, DUPLICATE_REASON_STRENGTH, MERGE_UNDO_DAYS, foldChar, contactSearchName } from "./dedupe-keys";
import * as viaBarrel from "./index";

describe("dedupe-keys: the TypeScript twins of 0106's key functions", () => {
  it.each([
    ["María", "maria"], ["  JOSÉ  ", "jose"], ["Muñoz", "munoz"], ["García-López", "garcia lopez"], ["O'Brien", "o brien"],
    ["Ruiz\u00A0Díaz", "ruiz diaz"], ["Ana\tMaría", "ana maria"], ["N/A", "na"], ["Zoë Brontë", "zoe bronte"],
    ["Ståhl", "sthl"], ["İsmail", "smail"], ["García\u3000López", "garcialopez"], ["李", ""], [null, ""],
  ])("nameFold(%j) = %j (mutation: .toLowerCase() anywhere -> 'İsmail' FAILS; a JS whitespace-class fold -> the ideographic-space row FAILS; .trim() cannot fail here, the drop already removes what it would)", (input, want) => {
    expect(nameFold(input)).toBe(want);
  });

  it.each([
    [["María", "García López"], "maria|garcia"], [["Maria", "Garcia"], "maria|garcia"], [["Juan Carlos", "García"], "juan carlos|garcia"],
    [["Ana", "de la Garza Treviño"], "ana|de la garza"], [["Luis", "San Miguel"], "luis|san miguel"], [["Rosa", "Santa Cruz"], "rosa|santa cruz"],
    [["Pedro", "García y López"], "pedro|garcia"], [["Pedro", "Delgado"], "pedro|delgado"], [["Ana", "de la"], "ana|de la"],
    [["Ana", ""], null], [["Ana", null], null], [[null, "Ruiz"], null], [["Caller", "Prueba"], null], [["Unknown", "Caller"], null],
    [["Desconocido", "Pérez"], null], [["N/A", "Pérez"], null], [["Sin Nombre", "Ruiz"], null], [["Cliente", "López"], null],
  ] as const)("nameKey(%j) = %j", ([first, last], want) => {
    expect(nameKey(first, last)).toBe(want);
  });

  it.each([
    ["+19562921696", "9562921696", "us"], ["(956) 292-1696", "9562921696", "us"], ["19562921696", "9562921696", "us"],
    ["+528999221234", "8999221234", "mx"], ["+52 1 899 922 1234", "8999221234", "mx"], ["044 899 922 1234", "8999221234", "mx"],
    ["045 899 922 1234", "8999221234", "mx"], ["01 899 922 1234", "8999221234", "mx"], ["+44 20 7946 0958", "442079460958", null],
    ["+5289992212345", "5289992212345", null], ["call after 5", "5", null], ["", null, null], [null, null, null],
  ] as const)("phoneNational(%j) = %j, family %j (mutation: drop the 521 branch -> the '+52 1' row FAILS)", (input, national, family) => {
    expect(phoneNational(input)).toBe(national);
    expect(phoneFamily(input)).toBe(family);
  });

  it("strength orders phone, email, conflict, digits, …, name last; an unknown reason is 8 (mutation: same_name 2 -> FAILS)", () => {
    expect(["same_phone", "same_email", "email_phone_conflict", "same_digits", "same_name"].map(reasonStrength)).toEqual([1, 2, 3, 4, 9]);
    expect(reasonStrength("whatever")).toBe(8);
    expect(Object.keys(DUPLICATE_REASON_STRENGTH).length).toBe(11);
  });

  it("labels: every reason maps to one of five words (mutation: phone_country_twin -> samePhone FAILS)", () => {
    expect(["same_phone", "phone_shared_new_person", "phone_match_on_edit", "phone_country_pick"].map(reasonLabel)).toEqual(Array(4).fill("samePhone"));
    expect(["same_digits", "phone_country_twin"].map(reasonLabel)).toEqual(["sameDigits", "sameDigits"]);
    expect(["same_email", "email_match_on_edit"].map(reasonLabel)).toEqual(["sameEmail", "sameEmail"]);
    expect(reasonLabel("same_name")).toBe("sameName");
    expect(["email_phone_conflict", "hidden_match", "merged_by_hand", "x"].map(reasonLabel)).toEqual(Array(4).fill("other"));
  });

  it("the Undo window is 30 days (owner ruling D7; mutation: 7 -> FAILS)", () => {
    expect(MERGE_UNDO_DAYS).toBe(30);
  });
});

describe("dedupe-keys: one home, reachable from the browser (recipient-language.test.ts:107-125's shape)", () => {
  it("has no runtime import, so a client component can take the subpath (mutation: import a value -> FAILS)", () => {
    const src = readFileSync(new URL("./dedupe-keys.ts", import.meta.url), "utf8");
    const runtimeImports = src.split("\n").filter((l) => /^import\s/.test(l) && !/^import\s+type\s/.test(l));
    expect(runtimeImports).toEqual([]);
  });
  it("is the same functions through the barrel (mutation: drop a re-export from index.ts -> FAILS)", () => {
    expect([viaBarrel.nameFold, viaBarrel.nameKey, viaBarrel.phoneNational, viaBarrel.phoneFamily, viaBarrel.reasonStrength, viaBarrel.reasonLabel])
      .toEqual([nameFold, nameKey, phoneNational, phoneFamily, reasonStrength, reasonLabel]);
    expect([viaBarrel.DUPLICATE_REASON_STRENGTH, viaBarrel.MERGE_UNDO_DAYS]).toEqual([DUPLICATE_REASON_STRENGTH, MERGE_UNDO_DAYS]);
  });
  it("is exported as the @bis/db/dedupe-keys subpath (mutation: drop the exports entry -> FAILS)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, string> };
    expect(pkg.exports["./dedupe-keys"]).toBe("./src/dedupe-keys.ts");
  });
});

describe("foldChar and contactSearchName (0108's twins)", () => {
  const collapse = (s: string) => s.replace(/ +/g, " ").replace(/^ | $/g, "");
  const CORPUS = [
    "María García López", "JOSÉ MUÑOZ", "garcía-lópez", "O'Brien", "Ruiz\u00A0Díaz", "Ana\tRuiz", "  Inés  Peña ",
    "Jose\u0301 Pe\u0301rez", "Zoë Brontë", "李 王", "Nguyễn Văn", "😀 Ana", "john_doe", "maria5@example.com", "",
  ];
  it.each(CORPUS)("nameFold(%j) is foldChar per code point, collapsed and trimmed (mutation: foldChar returns 'Ñ' unmapped -> the MUÑOZ row FAILS)", (s) => {
    expect(collapse([...s].map(foldChar).join(""))).toBe(nameFold(s));
  });
  it("foldChar answers one character of [a-z0-9 ] or nothing (mutation: return the unmapped character -> FAILS on '@')", () => {
    expect([..."ÑñÉé-.,'@\u0301😀Aa9 "].map(foldChar)).toEqual(["n", "n", "e", "e", " ", " ", " ", " ", "", "", "", "a", "a", "9", " "]);
  });
  it("contactSearchName joins the non-empty folds by one space, null when none (mutation: join with '|' -> FAILS)", () => {
    expect(contactSearchName("María", "García López", null)).toBe("maria garcia lopez");
    expect(contactSearchName("Juan", null, "Plomería Pérez")).toBe("juan plomeria perez");
    expect(contactSearchName(null, "Ruiz", "  ")).toBe("ruiz");
    expect(contactSearchName("李", "王", null)).toBeNull();
    expect(contactSearchName(null, null, null)).toBeNull();
    expect(contactSearchName("", "  ", "")).toBeNull();
  });
});
