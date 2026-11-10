import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto } from '@cw/shared';
import { api } from '../../services/api';

/** Number of unread notifications (shares the cache with the panel). */
export function useUnreadCount(campaignId: string): number {
  const list = useQuery({ queryKey: ['notifications', campaignId], queryFn: () => api.notifications(campaignId) });
  return list.data?.filter((n) => !n.read).length ?? 0;
}

const TYPE_LABEL: Record<string, string> = {
  war_declared: 'War', war_call: 'War', war_joined: 'War',
  alliance: 'Diplomacy', alliance_offer: 'Diplomacy', aid: 'Diplomacy',
  research_done: 'Research',
  building_complete: 'Building', local_factory: 'Building', recruitment_center: 'Building',
  recruited: 'Army', unit_ready: 'Army', general_level: 'General', general_defeated: 'General',
  capital_moved: 'Capital', capital_move_failed: 'Capital', ai_takeover: 'System',
};

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

interface Group {
  key: string;
  type: string;
  items: NotificationDto[];
}

/** Runs of the same kind of notification collapse into one row ("3x Army"), newest first. */
function group(list: NotificationDto[]): Group[] {
  const out: Group[] = [];
  for (const n of list) {
    const last = out[out.length - 1];
    if (last && last.type === n.type && last.items[0].read === n.read) last.items.push(n);
    else out.push({ key: n.id, type: n.type, items: [n] });
  }
  return out;
}

export function NotificationsPanel({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['notifications', campaignId], queryFn: () => api.notifications(campaignId) });
  const read = useMutation({
    mutationFn: () => api.readNotifications(campaignId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', campaignId] }),
  });
  const unread = list.data?.filter((n) => !n.read).length ?? 0;
  const groups = group((list.data ?? []).filter((n) => !onlyUnread || !n.read));

  return (
    <div className="card notifications">
      <div className="row between">
        <h2>
          Alerts {unread > 0 && <span className="badge">{unread}</span>}
        </h2>
        <div className="row">
          <button className={onlyUnread ? 'btn-sm' : 'btn-sm ghost'} onClick={() => setOnlyUnread(!onlyUnread)}>
            Unread only
          </button>
          {unread > 0 && (
            <button className="btn-sm" onClick={() => read.mutate()}>
              Mark all read
            </button>
          )}
        </div>
      </div>
      {groups.length === 0 && <p className="muted small">{onlyUnread ? 'Nothing unread.' : 'Nothing yet.'}</p>}
      <ul className="list compact alerts">
        {groups.map((g) => {
          const first = g.items[0];
          const label = TYPE_LABEL[g.type] ?? 'Info';
          const open = openKey === g.key;
          return (
            <li key={g.key} className={`${first.read ? 'read' : 'unread'} col`}>
              <div className="alert-row">
                <span className={`alert-tag tag-${label.toLowerCase()}`}>{label}</span>
                <span className="alert-text">{first.message}</span>
                <span className="muted small alert-time">{ago(first.createdAt)}</span>
              </div>
              {g.items.length > 1 && (
                <button className="link small" onClick={() => setOpenKey(open ? null : g.key)}>
                  {open ? 'Hide' : `Show ${g.items.length - 1} earlier like this`}
                </button>
              )}
              {open &&
                g.items.slice(1).map((n) => (
                  <div key={n.id} className="alert-row sub">
                    <span className="alert-text muted">{n.message}</span>
                    <span className="muted small alert-time">{ago(n.createdAt)}</span>
                  </div>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
