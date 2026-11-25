/** Shared text helpers for the build-time catalogue scripts. */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

export function shorten(text, max) {
  const value = String(text || "");
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

export function stripHtml(input) {
  return String(input || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
      if (ENTITIES[code]) return ENTITIES[code];
      if (code[0] === "#") {
        const value = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) ? String.fromCharCode(value) : match;
      }
      return match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(input) {
  const value = stripHtml(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return value || "untitled";
}

export function uniqueSlugFactory() {
  const seen = new Map();
  return (input) => {
    const base = slugify(input);
    const hits = seen.get(base) || 0;
    seen.set(base, hits + 1);
    return hits === 0 ? base : `${base}-${hits + 1}`;
  };
}

export const isoDate = (value) => (value ? String(value).slice(0, 10) : "");

export function formatRuntime(minutes) {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatDay(iso) {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
