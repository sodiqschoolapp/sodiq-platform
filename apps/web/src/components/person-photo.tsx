import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

const SIZES = { sm: 'size-8 text-xs', lg: 'size-24 text-2xl' } as const;

interface PersonPhotoProps<Key extends QueryKey> {
  /** The person's name: the photo's text for a screen reader. */
  name: string;
  /** One or two letters shown while there is no photo, it loads, or it failed. */
  initials: string;
  /** The query of the photo as a `data:` address, or `null` when the record has none. */
  photo: UseQueryOptions<string, Error, string, Key> | null;
  size?: keyof typeof SIZES;
}

/**
 * A person's photo, round (docs/design-system.md: "round for avatars"), with
 * the initials whenever there is no photo to show: none, loading, or a store
 * that is down (`edge/system-behaviour`: "photos fall back to initials").
 * Staff photos since task 2.2c-2; student photos use it in 2.4.
 */
export function PersonPhoto<Key extends QueryKey>({
  name,
  initials,
  photo,
  size = 'sm',
}: PersonPhotoProps<Key>) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground',
        SIZES[size],
      )}
    >
      <span aria-hidden>{initials}</span>
      {photo !== null && <LoadedPhoto name={name} photo={photo} />}
    </span>
  );
}

/** The photo over the initials, once it has loaded. */
function LoadedPhoto<Key extends QueryKey>({
  name,
  photo,
}: {
  name: string;
  photo: UseQueryOptions<string, Error, string, Key>;
}) {
  const query = useQuery(photo);
  return query.isSuccess ? (
    <img src={query.data} alt={name} className="absolute inset-0 size-full object-cover" />
  ) : null;
}

/** The first letter of the first name and of the last name, in capitals. */
export function initialsOf(firstName: string, lastName: string): string {
  return `${firstName.slice(0, 1)}${lastName.slice(0, 1)}`.toUpperCase();
}
