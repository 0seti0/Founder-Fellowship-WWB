import { env } from '../env'

export type CurrentDateContext = {
  today: string
  weekday: string
  timezone: string
}

export function currentDateContext(now = new Date()): CurrentDateContext {
  const timezone =
    env.APP_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const datePart = (type: 'year' | 'month' | 'day') =>
    dateParts.find((part) => part.type === type)!.value

  return {
    today: `${datePart('year')}-${datePart('month')}-${datePart('day')}`,
    weekday: new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      calendar: 'gregory',
      weekday: 'long',
    }).format(now),
    timezone,
  }
}
