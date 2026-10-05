/* eslint-disable @next/next/no-img-element -- small private images served by our own API */

export type AvatarPerson = { id: string; name: string; avatarUpdatedAt?: Date | string | null };

const SIZES = { xs: "h-6 w-6 text-[10px]", sm: "h-8 w-8 text-xs", md: "h-9 w-9 text-xs", lg: "h-12 w-12 text-sm", xl: "h-24 w-24 text-2xl" } as const;

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

// Profile photo, or the person's initials on the brand colour.
export function Avatar({ person, size = "md", className = "" }: { person: AvatarPerson; size?: keyof typeof SIZES; className?: string }) {
  const base = `${SIZES[size]} shrink-0 rounded-full ${className}`;
  if (person.avatarUpdatedAt) {
    const v = new Date(person.avatarUpdatedAt).getTime();
    return <img src={`/api/avatar/${person.id}?v=${v}`} alt={person.name} className={`${base} object-cover`} />;
  }
  return (
    <span aria-hidden className={`${base} brand-gradient flex items-center justify-center font-bold text-brand-ink`}>
      {initials(person.name)}
    </span>
  );
}
