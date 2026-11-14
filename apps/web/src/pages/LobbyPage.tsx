import { Flag } from '../components/art';
import { Crest } from '../components/Icon';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicUser } from '@cw/shared';
import { api } from '../services/api';

interface Props {
  user: PublicUser;
  onEnter: (campaignId: string) => void;
  onLogout: () => void;
}

export function LobbyPage({ user, onEnter, onLogout }: Props) {
  const qc = useQueryClient();
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: api.campaigns });
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const lobby = useQuery({
    queryKey: ['lobby', picking],
    queryFn: () => api.lobby(picking!),
    enabled: !!picking,
  });

  const join = useMutation({
    mutationFn: ({ campaignId, countryId }: { campaignId: string; countryId: string }) =>
      api.join(campaignId, countryId),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      onEnter(v.campaignId);
    },
    onError: (e) => {
      setError((e as Error).message);
      qc.invalidateQueries({ queryKey: ['lobby', picking] });
    },
  });

  const create = useMutation({
    mutationFn: () => api.createCampaign(newName),
    onSuccess: () => {
      setNewName('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (e) => setError((e as Error).message),
  });

  return (
    <div className="lobby">
      <header className="topbar">
        <Crest size={32} />
        <strong>Cold War 1950</strong>
        <span className="spacer" />
        <span className="muted">Signed in as {user.username}</span>
        <button onClick={onLogout}>Log out</button>
      </header>

      <main className="lobby-main">
        <section className="card">
          <h2>Campaigns</h2>
          {campaigns.isLoading && <p className="muted">Loading…</p>}
          {campaigns.error && <p className="error">{(campaigns.error as Error).message}</p>}
          <ul className="list">
            {campaigns.data?.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{c.name}</strong>
                  <div className="muted small">
                    Starts {c.startYear} · {c.playerCount} player{c.playerCount === 1 ? '' : 's'}
                  </div>
                </div>
                {c.myCountryId ? (
                  <button className="primary" onClick={() => onEnter(c.id)}>
                    Enter
                  </button>
                ) : (
                  <button onClick={() => (setPicking(c.id), setError(null))}>Choose a country</button>
                )}
              </li>
            ))}
          </ul>

          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <input
              placeholder="New campaign name"
              value={newName}
              minLength={3}
              maxLength={60}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button disabled={newName.trim().length < 3 || create.isPending}>Create campaign</button>
          </form>
        </section>

        {picking && (
          <section className="card">
            <h2>Choose your country</h2>
            {error && <p className="error">{error}</p>}
            {lobby.isLoading && <p className="muted">Loading…</p>}
            <ul className="list">
              {lobby.data
                ?.filter((c) => c.isPlayable)
                .map((c) => (
                  <li key={c.id}>
                    <div>
                      <span className="flag-slot">
                        <Flag code={c.code} color={c.color} width={30} />
                      </span>
                      <strong>{c.name}</strong>
                      <div className="muted small">
                        {c.blurb} · {c.provinceCount} provinces
                      </div>
                    </div>
                    <button
                      className="primary"
                      disabled={c.claimed || join.isPending}
                      onClick={() => join.mutate({ campaignId: picking, countryId: c.id })}
                    >
                      {c.claimed ? 'Taken' : 'Play'}
                    </button>
                  </li>
                ))}
            </ul>
            <button className="link" onClick={() => setPicking(null)}>
              Cancel
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
