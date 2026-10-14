import {
  ROOM_TYPES,
  type Building,
  type Room,
  type RoomStatus,
  type RoomType,
} from '@sodiq/shared';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { useMemo, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/states';
import { buttonVariants } from '@/components/ui/button';
import { FOCUS_RING, PANEL, QUICK } from '@/components/ui/control';
import { Select } from '@/components/ui/select';

/**
 * The colour of a room type: five of the twelve subject colour tokens, none
 * orange and none in the hues of the status dots (task 2.7c-3, decision 9,
 * changed at the review of the plan). The type is always written beside it.
 */
export const ROOM_TYPE_COLOURS: Record<RoomType, string> = {
  classroom: 'bg-subject-blue',
  laboratory: 'bg-subject-cyan',
  sports_hall: 'bg-subject-indigo',
  hall: 'bg-subject-violet',
  other: 'bg-subject-pink',
};

/** The status dot: the tokens of the status words; the status is always written beside it. */
export const ROOM_STATUS_COLOURS: Record<RoomStatus, string> = {
  in_use: 'bg-success',
  under_repair: 'bg-warning',
  closed: 'bg-destructive',
};

/** The building and floor shown, as the address names them. */
export interface FloorChoiceInAddress {
  building?: string | undefined;
  floor?: string | undefined;
}

interface RoomsByFloorProps {
  /** The rooms the toolbar leaves, in the order of the list when it chose one. */
  rooms: readonly Room[];
  /** Whether the list chose an order; else the cards are by name. */
  sorted: boolean;
  /** Every room of the branch: tells "no room on this floor" from "none matches". */
  allRooms: readonly Room[];
  buildings: readonly Building[];
  chosen: FloorChoiceInAddress;
  onChoose: (next: { building: string; floor: string | undefined }) => void;
  open: (id: string) => void;
}

/**
 * The Rooms "By floor" view (issue #39, item 5; task 2.7c-3): the buildings
 * of the branch on the left with the number of their cards, the floors of the
 * chosen building as tabs, the rooms of the floor as cards (name, type by
 * colour with a legend, capacity, status dot, "shared: n at once"). The same
 * rows as the list; a card opens the side panel as a row does. Archived
 * buildings and floors are left out (decision 10).
 */
export function RoomsByFloor({
  rooms,
  sorted,
  allRooms,
  buildings,
  chosen,
  onChoose,
  open,
}: RoomsByFloorProps) {
  const { t, i18n } = useTranslation();
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const byName = useMemo(
    () => new Intl.Collator(i18n.language, { numeric: true, sensitivity: 'base' }),
    [i18n.language],
  );
  const tabs = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () =>
      buildings
        .filter((building) => building.archivedAt === null)
        .map((building) => ({
          ...building,
          floors: building.floors.filter((floor) => floor.archivedAt === null),
        }))
        .sort((a, b) => byName.compare(a.name, b.name)),
    [buildings, byName],
  );

  if (active.length === 0) {
    return (
      <EmptyState
        text={t('setup.rooms.noActiveBuilding')}
        action={
          <Link to="/setup/buildings" className={buttonVariants({ variant: 'secondary' })}>
            {t('setup.rooms.goToBuildings')}
          </Link>
        }
      />
    );
  }

  // The address wins while it names an active building and floor; else the first.
  const building = active.find((one) => one.id === chosen.building) ?? active[0];
  if (building === undefined) {
    return null;
  }
  const floor = building.floors.find((one) => one.id === chosen.floor) ?? building.floors[0];
  const cardsOf = (floorIds: readonly string[]): Room[] =>
    rooms.filter((room) => floorIds.includes(room.floorId));
  const shown = floor === undefined ? [] : cardsOf([floor.id]);
  const cards = sorted ? shown : [...shown].sort((a, b) => byName.compare(a.name, b.name));
  const onFloor =
    floor === undefined ? 0 : allRooms.filter((room) => room.floorId === floor.id).length;

  const chooseBuilding = (id: string): void => {
    onChoose({ building: id, floor: undefined });
  };
  const chooseFloor = (id: string): void => {
    onChoose({ building: building.id, floor: id });
  };

  /** The arrows, Home and End move between the floor tabs (WAI-ARIA tabs). */
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = building.floors.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    const target = next === null ? undefined : building.floors[next];
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    chooseFloor(target.id);
    window.setTimeout(() => {
      tabs.current?.querySelector<HTMLElement>(`[data-floor="${CSS.escape(target.id)}"]`)?.focus();
    }, 0);
  };

  const cardCount = (id: string): number =>
    cardsOf((active.find((one) => one.id === id)?.floors ?? []).map((one) => one.id)).length;

  const tabId = (id: string): string => `floor-tab-${id}`;

  return (
    <div className={cn(PANEL, 'grid gap-6 sm:grid-cols-[14rem_minmax(0,1fr)]')}>
      {/* The buildings: a list like the menu's items on a wide screen, a
          select at phone width (decision 12). */}
      <nav aria-label={t('setup.rooms.buildingsNav')} className="max-sm:hidden">
        <ul className="grid gap-1">
          {active.map((one) => {
            const count = cardCount(one.id);
            const current = one.id === building.id;
            return (
              <li key={one.id}>
                <button
                  type="button"
                  aria-current={current ? 'true' : undefined}
                  aria-label={t('setup.rooms.buildingCards', {
                    name: one.name,
                    count,
                    n: number.format(count),
                  })}
                  onClick={() => {
                    chooseBuilding(one.id);
                  }}
                  className={cn(
                    'flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm',
                    current ? 'bg-accent font-semibold' : 'hover:bg-muted',
                    QUICK,
                    FOCUS_RING,
                  )}
                >
                  <span className="min-w-0 truncate">{one.name}</span>
                  <span className="tabular-nums text-muted-foreground" aria-hidden>
                    {number.format(count)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <label className="grid gap-0.5 text-xs text-muted-foreground sm:hidden">
        {t('setup.rooms.buildingsNav')}
        <Select
          value={building.id}
          onChange={(event) => {
            chooseBuilding(event.target.value);
          }}
        >
          {active.map((one) => {
            const count = cardCount(one.id);
            return (
              <option key={one.id} value={one.id}>
                {t('setup.rooms.buildingOption', { name: one.name, n: number.format(count) })}
              </option>
            );
          })}
        </Select>
      </label>

      <div className="grid min-w-0 content-start gap-4">
        {building.floors.length === 0 || floor === undefined ? (
          <p className="text-sm">{t('setup.rooms.noFloorInBuilding')}</p>
        ) : (
          <>
            {/* The tabs of a page's sections (task 2.7c-1, decision 9; the
                review of this plan, correction 3), switching content in place. */}
            <div
              ref={tabs}
              role="tablist"
              aria-label={t('setup.rooms.floorsTabs')}
              className="flex gap-6 overflow-x-auto border-b whitespace-nowrap"
            >
              {building.floors.map((one, index) => {
                const selected = one.id === floor.id;
                return (
                  <button
                    key={one.id}
                    type="button"
                    role="tab"
                    id={tabId(one.id)}
                    data-floor={one.id}
                    aria-selected={selected}
                    aria-controls="floor-rooms"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => {
                      chooseFloor(one.id);
                    }}
                    onKeyDown={(event) => {
                      onTabKey(event, index);
                    }}
                    className={cn(
                      'shrink-0 border-b-2 px-1 pb-2 max-sm:pt-3',
                      selected
                        ? 'border-foreground font-semibold'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                      QUICK,
                      FOCUS_RING,
                    )}
                  >
                    {one.name}
                  </button>
                );
              })}
            </div>
            <div
              id="floor-rooms"
              role="tabpanel"
              aria-labelledby={tabId(floor.id)}
              className="grid gap-4"
            >
              {/* The legend of the type colours, in the caption size. */}
              <ul
                aria-label={t('setup.rooms.legend')}
                className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
              >
                {ROOM_TYPES.map((type) => (
                  <li key={type} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn('size-2.5 shrink-0', ROOM_TYPE_COLOURS[type])}
                    />
                    {t(`setup.rooms.types.${type}`)}
                  </li>
                ))}
              </ul>
              {cards.length === 0 ? (
                <p className="text-sm">
                  {onFloor === 0 ? t('setup.rooms.noRoomOnFloor') : t('setup.rooms.noRoomMatches')}
                </p>
              ) : (
                <ul
                  aria-label={floor.name}
                  className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-3"
                >
                  {cards.map((room) => (
                    <li key={room.id} className="grid">
                      <button
                        type="button"
                        data-open-row={room.id}
                        onClick={() => {
                          open(room.id);
                        }}
                        className={cn(
                          'grid min-h-11 content-start gap-1.5 rounded-lg border bg-card p-3 text-left text-sm hover:bg-muted',
                          QUICK,
                          FOCUS_RING,
                        )}
                      >
                        <span className="text-base font-semibold">{room.name}</span>
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className={cn('size-2.5 shrink-0', ROOM_TYPE_COLOURS[room.type])}
                          />
                          {t(`setup.rooms.types.${room.type}`)}
                        </span>
                        <span className="tabular-nums">
                          {t('setup.rooms.seats', {
                            count: room.capacity,
                            n: number.format(room.capacity),
                          })}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              ROOM_STATUS_COLOURS[room.status],
                            )}
                          />
                          {t(`setup.rooms.statuses.${room.status}`)}
                        </span>
                        {room.shared && room.maxSimultaneousLessons !== null && (
                          <span className="text-muted-foreground">
                            {t('setup.rooms.sharedCard', {
                              count: room.maxSimultaneousLessons,
                              n: number.format(room.maxSimultaneousLessons),
                            })}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
