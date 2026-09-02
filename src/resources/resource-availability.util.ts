import type { ResourceSchedule } from './resource-schedule.entity.js';

interface Interval {
  start: Date;
  end: Date;
}

function subtractIntervals(window: Interval, busy: Interval[]): Interval[] {
  const relevant = busy
    .filter((b) => b.start < window.end && b.end > window.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const free: Interval[] = [];
  let cursor = window.start;

  for (const b of relevant) {
    const busyStart = b.start < window.start ? window.start : b.start;
    const busyEnd = b.end > window.end ? window.end : b.end;
    if (busyStart > cursor) {
      free.push({ start: cursor, end: busyStart });
    }
    if (busyEnd > cursor) {
      cursor = busyEnd;
    }
  }

  if (cursor < window.end) {
    free.push({ start: cursor, end: window.end });
  }

  return free;
}

function buildScheduleWindow(calendarDate: Date, schedule: ResourceSchedule): Interval {
  const [openHours, openMinutes] = schedule.openTime.split(':').map(Number);
  const [closeHours, closeMinutes] = schedule.closeTime.split(':').map(Number);

  const start = new Date(calendarDate);
  start.setUTCHours(openHours, openMinutes, 0, 0);

  const end = new Date(calendarDate);
  end.setUTCHours(closeHours, closeMinutes, 0, 0);

  return { start, end };
}

export function computeFreeIntervals(
  schedules: ResourceSchedule[],
  confirmedReservations: { startsAt: Date; endsAt: Date }[],
  from: Date,
  to: Date,
): Interval[] {
  const busy = confirmedReservations.map((r) => ({ start: r.startsAt, end: r.endsAt }));
  const free: Interval[] = [];

  const cursorDate = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const lastDate = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
  );

  while (cursorDate.getTime() <= lastDate.getTime()) {
    const dayOfWeek = cursorDate.getUTCDay();
    const daySchedules = schedules.filter((s) => s.dayOfWeek === dayOfWeek);

    for (const schedule of daySchedules) {
      const window = buildScheduleWindow(cursorDate, schedule);
      const clippedStart = window.start < from ? from : window.start;
      const clippedEnd = window.end > to ? to : window.end;

      if (clippedStart < clippedEnd) {
        free.push(...subtractIntervals({ start: clippedStart, end: clippedEnd }, busy));
      }
    }

    cursorDate.setUTCDate(cursorDate.getUTCDate() + 1);
  }

  free.sort((a, b) => a.start.getTime() - b.start.getTime());
  return free;
}
