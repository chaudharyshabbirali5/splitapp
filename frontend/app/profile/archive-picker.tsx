'use client';

import { useState } from 'react';

import { ArchiveGroup } from '../groups/[id]/archive-group';

export type ArchivableGroup = { id: string; name: string };

/**
 * The second half of the archive relocation.
 *
 * Archiving used to live on the group-detail screen, where the group was
 * implied. Here it is not, so this picks the group first and then hands off to
 * the EXISTING ArchiveGroup control — same component, same server action, same
 * type-the-name confirmation. Nothing about the archive logic is reimplemented.
 *
 * Only groups the signed-in user created are listed, because only a creator can
 * archive. That is convenience, not security: archive_group() and the
 * groups_update policy both enforce it again server-side.
 */
export function ArchivePicker({ groups }: { groups: ArchivableGroup[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (groups.length === 0) {
    return (
      <p className="hint">
        Only the person who created a group can archive it. You haven&rsquo;t created any
        active groups.
      </p>
    );
  }

  const selected = groups.find((g) => g.id === selectedId) ?? null;

  if (selected) {
    return (
      <div className="flex flex-col gap-2">
        <p className="khata-label">Archiving {selected.name}</p>
        <ArchiveGroup groupId={selected.id} groupName={selected.name} />
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className="link-back w-full text-center"
        >
          Pick a different group
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="archive-group" className="khata-label block">
        Archive a group
      </label>
      <select
        id="archive-group"
        className="field"
        defaultValue=""
        onChange={(e) => setSelectedId(e.target.value || null)}
      >
        <option value="">Choose a group…</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <p className="hint">
        Archiving hides a group from everyone in it. Nothing is deleted, and it can be
        restored later.
      </p>
    </div>
  );
}
