/** Source69 TV guide clocks omit the day period in the ruler/cells. Sheets retain the full
 * canonical programme range. Only format actual instants, in the device's genuine zone. */
export function nativeGuideClock(locale: string, timeZone: string, hour12?: boolean, omitDayPeriod = true): (at: number) => string | undefined {
  let formatter: Intl.DateTimeFormat;
  try {formatter = new Intl.DateTimeFormat(locale, {hour: 'numeric', minute: '2-digit', timeZone, ...(hour12 === undefined ? {} : {hour12})});}
  catch {return () => undefined;}
  return at => Number.isFinite(at) && Number.isFinite(new Date(at).getTime())
    ? formatter.formatToParts(at).filter(part => !omitDayPeriod || part.type !== 'dayPeriod').map(part => part.value).join('').replace(/[\u00a0\u202f]/g, ' ').trim()
    : undefined;
}
