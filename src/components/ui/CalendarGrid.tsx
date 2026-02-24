import { AriaCalendarGridProps, useCalendarGrid, useLocale } from 'react-aria';
import { getWeeksInMonth } from '@internationalized/date';
import { CalendarState, RangeCalendarState } from 'react-stately';
import { CalendarCell } from './CalendarCell';

interface CalendarGridProps extends AriaCalendarGridProps {
  state: CalendarState | RangeCalendarState;
}
export function CalendarGrid({ state, ...props }: CalendarGridProps) {
  const { locale } = useLocale();
  const { gridProps, headerProps, weekDays } = useCalendarGrid(props, state);

  // Get the number of weeks in the month so we can render the proper number of rows.
  const weeksInMonth = getWeeksInMonth(state.visibleRange.start, locale);

  return (
    <table {...gridProps} cellPadding="0" className="flex-1">
      <thead {...headerProps}>
        <tr>
          {weekDays.map((day, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <th className="text-center text-sm font-semibold text-muted-foreground" key={i}>
              {day}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[...new Array(weeksInMonth).keys()].map((weekIndex) => (
          <tr key={weekIndex}>
            {state.getDatesInWeek(weekIndex).map((date, i) =>
              date ? (
                // eslint-disable-next-line react/no-array-index-key
                <CalendarCell key={i} state={state} date={date} />
              ) : (
                // eslint-disable-next-line react/no-array-index-key, jsx-a11y/control-has-associated-label
                <td key={i} aria-hidden="true" />
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
