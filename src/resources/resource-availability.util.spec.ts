import type { ResourceSchedule } from './resource-schedule.entity.js';
import { computeFreeIntervals } from './resource-availability.util.js';

const MONDAY = new Date('2026-02-02T00:00:00.000Z');
const MONDAY_DOW = MONDAY.getUTCDay();
const NEXT_DAY = new Date('2026-02-03T00:00:00.000Z');

function schedule(
  dayOfWeek: number,
  openTime: string,
  closeTime: string,
): ResourceSchedule {
  return { dayOfWeek, openTime, closeTime } as ResourceSchedule;
}

function reservation(startsAt: string, endsAt: string) {
  return { startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
}

describe('computeFreeIntervals', () => {
  it('returns no free intervals when the resource has no schedules at all', () => {
    const result = computeFreeIntervals([], [], MONDAY, NEXT_DAY);

    expect(result).toEqual([]);
  });

  it('returns exactly the schedule window when there are no reservations', () => {
    const schedules = [schedule(MONDAY_DOW, '09:00', '17:00')];

    const result = computeFreeIntervals(schedules, [], MONDAY, NEXT_DAY);

    expect(result).toEqual([
      {
        start: new Date('2026-02-02T09:00:00.000Z'),
        end: new Date('2026-02-02T17:00:00.000Z'),
      },
    ]);
  });

  it('returns no free intervals for a day whose reservation covers the entire window', () => {
    const schedules = [schedule(MONDAY_DOW, '09:00', '17:00')];
    const reservations = [
      reservation('2026-02-02T09:00:00.000Z', '2026-02-02T17:00:00.000Z'),
    ];

    const result = computeFreeIntervals(schedules, reservations, MONDAY, NEXT_DAY);

    expect(result).toEqual([]);
  });

  it('splits the window into a free interval before and after a mid-window reservation', () => {
    const schedules = [schedule(MONDAY_DOW, '09:00', '17:00')];
    const reservations = [
      reservation('2026-02-02T12:00:00.000Z', '2026-02-02T13:00:00.000Z'),
    ];

    const result = computeFreeIntervals(schedules, reservations, MONDAY, NEXT_DAY);

    expect(result).toEqual([
      {
        start: new Date('2026-02-02T09:00:00.000Z'),
        end: new Date('2026-02-02T12:00:00.000Z'),
      },
      {
        start: new Date('2026-02-02T13:00:00.000Z'),
        end: new Date('2026-02-02T17:00:00.000Z'),
      },
    ]);
  });

  it('does not clip the window when a reservation only touches its boundary without overlapping', () => {
    const schedules = [schedule(MONDAY_DOW, '09:00', '17:00')];
    const reservations = [
      reservation('2026-02-02T07:00:00.000Z', '2026-02-02T09:00:00.000Z'),
      reservation('2026-02-02T17:00:00.000Z', '2026-02-02T19:00:00.000Z'),
    ];

    const result = computeFreeIntervals(schedules, reservations, MONDAY, NEXT_DAY);

    expect(result).toEqual([
      {
        start: new Date('2026-02-02T09:00:00.000Z'),
        end: new Date('2026-02-02T17:00:00.000Z'),
      },
    ]);
  });

  it('processes two schedule windows on the same day independently', () => {
    const schedules = [
      schedule(MONDAY_DOW, '09:00', '12:00'),
      schedule(MONDAY_DOW, '14:00', '18:00'),
    ];

    const result = computeFreeIntervals(schedules, [], MONDAY, NEXT_DAY);

    expect(result).toEqual([
      {
        start: new Date('2026-02-02T09:00:00.000Z'),
        end: new Date('2026-02-02T12:00:00.000Z'),
      },
      {
        start: new Date('2026-02-02T14:00:00.000Z'),
        end: new Date('2026-02-02T18:00:00.000Z'),
      },
    ]);
  });

  it('clips the window to a requested from/to range that falls mid-day', () => {
    const schedules = [schedule(MONDAY_DOW, '09:00', '17:00')];
    const from = new Date('2026-02-02T11:00:00.000Z');
    const to = new Date('2026-02-02T15:00:00.000Z');

    const result = computeFreeIntervals(schedules, [], from, to);

    expect(result).toEqual([
      {
        start: new Date('2026-02-02T11:00:00.000Z'),
        end: new Date('2026-02-02T15:00:00.000Z'),
      },
    ]);
  });
});
