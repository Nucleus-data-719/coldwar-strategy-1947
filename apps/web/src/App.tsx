import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './services/api';
import { disconnectSocket } from './services/socket';
import { AuthPage } from './pages/AuthPage';
import { LobbyPage } from './pages/LobbyPage';
import { GamePage } from './pages/GamePage';

const STORAGE_KEY = 'cw_campaign';

export default function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [campaignId, setCampaignId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const enter = (id: string | null) => {
    setCampaignId(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage can be unavailable; the app still works */
    }
  };

  const logout = async () => {
    await api.logout();
    disconnectSocket();
    enter(null);
    qc.clear();
    await qc.invalidateQueries({ queryKey: ['me'] });
  };

  if (me.isLoading) return <div className="center">Loading…</div>;
  if (me.error) return <div className="center error">Cannot reach the server: {(me.error as Error).message}</div>;
  if (!me.data) return <AuthPage />;
  if (!campaignId) return <LobbyPage user={me.data} onEnter={enter} onLogout={logout} />;
  return <GamePage campaignId={campaignId} onLeave={() => enter(null)} onLogout={logout} />;
}
