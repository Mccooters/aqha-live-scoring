import { escapeIlike } from "./memberAuth";

export function cleanHorseFields(body) {
  return {
    horse_name: String(body?.horse_name ?? "").trim().replace(/\s+/g, " "),
    breed: String(body?.breed ?? "").trim() || null,
    registrations: String(body?.registrations ?? "").trim() || null,
    notes: String(body?.notes ?? "").trim() || null,
  };
}

function normalizeHorseName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function formatRegistryRegistrations(rows) {
  return (rows ?? [])
    .map((row) => [row.club, row.registration_number].filter(Boolean).join(" ").trim())
    .filter(Boolean)
    .join(", ") || null;
}

function registryAccessMessage(error) {
  const haystack = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  if (haystack.includes("permission denied") || haystack.includes("42501")) {
    return "Member horse numbering couldn't access the horse registry. Run the schema-v28 database update.";
  }
  return error?.message ?? "Could not check the horse registry.";
}

async function findRegistryHorse(db, horseName) {
  const normalized = normalizeHorseName(horseName);
  if (!normalized) return null;
  const cleanedName = String(horseName ?? "").trim().replace(/\s+/g, " ");

  const { data, error } = await db
    .from("horses")
    .select("id, back_number, name, horse_registrations(club, registration_number)")
    .ilike("name", escapeIlike(cleanedName))
    .order("back_number")
    .limit(10);
  if (error) throw new Error(registryAccessMessage(error));

  return (data ?? []).find((horse) => normalizeHorseName(horse.name) === normalized) ?? null;
}

async function nextAvailableBackNumber(db, ignoreMemberHorseId = null, reservedBackNumbers = []) {
  const [registryResult, memberResult] = await Promise.all([
    db.from("horses").select("back_number").order("back_number"),
    db.from("club_member_horses").select("id, back_number").not("back_number", "is", null),
  ]);
  if (registryResult.error) throw new Error(registryAccessMessage(registryResult.error));
  if (memberResult.error) throw new Error(memberResult.error.message);

  // Back numbers are permanent, so issue the next number after the highest
  // known one instead of recycling gaps in old registry data.
  let highest = 0;
  (registryResult.data ?? []).forEach((row) => {
    if (Number.isInteger(row.back_number) && row.back_number > highest) highest = row.back_number;
  });
  (memberResult.data ?? []).forEach((row) => {
    if (row.id === ignoreMemberHorseId) return;
    if (Number.isInteger(row.back_number) && row.back_number > highest) highest = row.back_number;
  });
  reservedBackNumbers.forEach((backNumber) => {
    if (Number.isInteger(backNumber) && backNumber > highest) highest = backNumber;
  });

  return highest + 1;
}

// "AQHA Q-12345, PHAA 678" → [{club:"AQHA", registration_number:"Q-12345"}, …]
// Best-effort parse of the free-text registrations a member types.
export function parseRegistrationsText(text) {
  return String(text ?? "")
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const m = t.match(/^([A-Za-z]{2,10})[\s:#-]*([A-Za-z0-9-]+)$/);
      return m ? { club: m[1].toUpperCase(), registration_number: m[2] } : null;
    })
    .filter(Boolean);
}

// Back numbers are permanent and the registry is the record of who holds
// them — so the moment a member horse is issued a BRAND-NEW number it is
// also written into the public `horses` registry (owner's report, Sept 2026:
// member-portal horses were reserving numbers without appearing in the
// registry, which read as "numbers skipping"). Idempotent: a number already
// in the registry is left alone. Never throws — a registry hiccup must not
// break a membership or portal save; the number is still reserved either way.
export async function registerHorseInRegistry(db, { back_number, name, owner, registrations }) {
  if (!Number.isInteger(back_number) || !String(name ?? "").trim()) return { added: false };
  try {
    const { data: existing } = await db.from("horses").select("id").eq("back_number", back_number).maybeSingle();
    if (existing) return { added: false, horse_id: existing.id };
    const { data: horse, error } = await db
      .from("horses")
      .insert({ back_number, name: String(name).trim().replace(/\s+/g, " "), owner: owner || null })
      .select("id")
      .single();
    if (error) {
      if (!/23505|duplicate/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
        console.error("registerHorseInRegistry:", error.message);
      }
      return { added: false };
    }
    const regs = parseRegistrationsText(registrations);
    if (regs.length) {
      await db.from("horse_registrations").insert(regs.map((r) => ({ horse_id: horse.id, ...r })));
    }
    return { added: true, horse_id: horse.id };
  } catch (err) {
    console.error("registerHorseInRegistry:", err?.message ?? err);
    return { added: false };
  }
}

export async function assignHorseNumber(db, fields, existingRow = null, reservedBackNumbers = []) {
  const registryHorse = await findRegistryHorse(db, fields.horse_name);
  const registryRegistrations = formatRegistryRegistrations(registryHorse?.horse_registrations);
  let backNumber = registryHorse?.back_number ?? existingRow?.back_number ?? null;
  if (backNumber == null) {
    backNumber = await nextAvailableBackNumber(db, existingRow?.id, reservedBackNumbers);
  }

  return {
    fields: {
      ...fields,
      horse_name: registryHorse?.name ?? fields.horse_name,
      back_number: backNumber,
      registrations: fields.registrations || registryRegistrations,
    },
    suggestion: {
      matched_registry: !!registryHorse,
      back_number: backNumber,
      horse_name: registryHorse?.name ?? fields.horse_name,
      registrations: registryRegistrations,
    },
  };
}
