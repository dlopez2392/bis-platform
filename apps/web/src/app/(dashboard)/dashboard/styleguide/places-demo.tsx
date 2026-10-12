"use client";

import { LocaleProvider } from "@/components/locale-provider";
import type { PlacesLoad } from "@/lib/contacts/places-load";
import { PlacesCardView } from "../accounts/[accountId]/contacts/places-card";

/**
 * The Properties card (S-02 part B2, spec §8) in every state it has, in both languages. A client
 * component of its own because the card's handlers are functions a server page cannot hand down
 * (relationships-demo.tsx's reasoning); here they do nothing. The loaded card shows the person's
 * own home with an Open map link, an AC that replaced an older one (Earlier units), a unit under
 * warranty and one whose warranty ended, a household's ranch with only a landmark, and a removed
 * property. The Technician's copy has no "Belongs to". Tab through it to see the focus rings.
 */
type Data = Extract<PlacesLoad, { status: "ready" }>["data"];
const SUBJECT = "sg-ana";
const stamp = { account_id: "sg", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const place = (over: Partial<Data["places"][number]>): Data["places"][number] => ({
  id: "sg-p", contact_id: SUBJECT, client_group_id: null, label: null, address: null, landmark: null, directions: null,
  city: null, region: null, postal_code: null, country: null, archived_at: null, ...stamp, ...over,
});
const unit = (over: Partial<Data["equipment"][number]>): Data["equipment"][number] => ({
  id: "sg-u", place_id: "sg-p1", name: "AC upstairs", make: null, model: null, serial: null, notes: null,
  installed_on: null, warranty_until: null, replaces_id: null, ...stamp, ...over,
});
const DATA: Data = {
  subject: { id: SUBJECT, firstName: "Ana", lastName: "Garza" },
  today: "2026-10-12",
  groups: [{ id: "sg-g1", kind: "household", name: "Casa Garza", isPrimary: true }],
  places: [
    place({
      id: "sg-p1", label: "Casa", address: "1204 Nolana Ave", city: "McAllen", region: "TX", postal_code: "78504", country: "US",
      landmark: "The blue house past the canal", directions: "Side gate on the left. Two friendly dogs. Park on the street.",
    }),
    place({ id: "sg-p2", contact_id: null, client_group_id: "sg-g1", label: "Rancho", landmark: "Past the Valero on FM 1015, second gate", created_at: "2026-10-02T00:00:00Z" }),
    place({ id: "sg-p3", label: "Rental on 10th St", address: "418 N 10th St", archived_at: "2026-10-05T00:00:00Z" }),
  ],
  placeCount: 3,
  equipment: [
    unit({ id: "sg-u1", make: "Carrier", model: "24ACC6", installed_on: "2011-04-02" }),
    unit({ id: "sg-u2", make: "Rheem", model: "RA14", serial: "W1823K0451", installed_on: "2021-06-01", warranty_until: "2031-06-01", replaces_id: "sg-u1", created_at: "2026-10-03T00:00:00Z" }),
    unit({ id: "sg-u3", name: "Water heater", make: "A. O. Smith", warranty_until: "2024-01-15", created_at: "2026-10-04T00:00:00Z" }),
  ],
  equipmentCount: 3,
};
const READY: PlacesLoad = { status: "ready", data: DATA };
const STATES: PlacesLoad[] = [
  { status: "ready", data: { ...DATA, places: [], placeCount: 0, equipment: [], equipmentCount: 0 } },
  { status: "loading" },
  { status: "error" },
];

const noop = () => {};
const handlers = {
  removePlace: async () => {}, putBack: async () => {}, removeUnit: async () => {},
  placeAdded: noop, unitAdded: noop, unitReplaced: noop, ownerChanged: noop, changed: noop,
};
const common = { accountId: "sg", contactId: SUBJECT, onRetry: noop, handlers };
const box = "min-w-0 rounded-[var(--radius-card)] border border-border p-4";

export function PlacesDemo() {
  return (
    <div className="grid w-full gap-4 md:grid-cols-2" data-testid="styleguide-places">
      <div className={box}><PlacesCardView {...common} canMovePlace load={READY} /></div>
      <div className={box}>
        <LocaleProvider locale="es"><PlacesCardView {...common} canMovePlace load={READY} /></LocaleProvider>
      </div>
      <div className={box}><PlacesCardView {...common} canMovePlace={false} load={READY} /></div>
      {STATES.map((load) => (
        <div key={load.status === "ready" ? "empty" : load.status} className={box}>
          <PlacesCardView {...common} canMovePlace load={load} />
        </div>
      ))}
    </div>
  );
}
