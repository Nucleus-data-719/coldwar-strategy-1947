import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';

/** Number of unread notifications (shares the cache with the panel). */
export function useUnreadCount(campaignId: string): number {
  const list = useQuery({ queryKey: ['notifications', campaignId], queryFn: () => api.notifications(campaignId) });
  return list.data?.filter((n) => !n.read).length ?? 0;
}

export function NotificationsPanel({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['notifications', campaignId], queryFn: () => api.notifications(campaignId) });
  const read = useMutation({
    mutationFn: () => api.readNotifications(campaignId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', campaignId] }),
  });
  const unread = list.data?.filter((n) => !n.read).length ?? 0;

  return (
    <div className="card notifications">
      <div className="row between">
        <h2>
          Notifications {unread > 0 && <span className="badge">{unread}</span>}
        </h2>
        {unread > 0 && (
          <button className="link" onClick={() => read.mutate()}>
            Mark read
          </button>
        )}
      </div>
      {list.data?.length === 0 && <p className="muted small">Nothing yet.</p>}
      <ul className="list compact">
        {list.data?.map((n) => (
          <li key={n.id} className={n.read ? 'muted' : ''}>
            <span>{n.message}</span>
            <span className="muted small">{new Date(n.createdAt).toLocaleTimeString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
