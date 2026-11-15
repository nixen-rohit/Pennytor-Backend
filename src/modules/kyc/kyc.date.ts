/**
 * Date-of-birth is a calendar date, not an instant in time. We always persist
 * it pinned to 00:00 UTC so the stored day matches exactly what the user
 * picked — otherwise a browser serialising local midnight (e.g. 10/06/1984
 * 00:00 IST = 09/06/1984 18:30 UTC) shifts the date by one day in the DB.
 */
export function toUtcDateOnly(value: string | Date): Date {
  if (value == null) return value as unknown as Date;
  const raw =
    value instanceof Date ? value.toISOString() : String(value).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (dateOnly) {
    return new Date(
      Date.UTC(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      ),
    );
  }
  const parsed = new Date(raw);
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
}
