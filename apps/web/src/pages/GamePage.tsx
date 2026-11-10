import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { WorldMap } from '../features/world-map/WorldMap';
import { ResourceBar, useProjectedBalance } from '../features/economy/ResourceBar';
import { ProvincePanel } from '../features/economy/ProvincePanel';
import { EconomyPanel } from '../features/economy/EconomyPanel';
import { NotificationsPanel } from '../features/economy/NotificationsPanel';
import { ArmiesPanel } from '../features/military/ArmiesPanel';
import { MovePanel } from '../features/military/MovePanel';
import { BattlesPanel } from '../features/military/BattlesPanel';
import { WarsPanel } from '../features/diplomacy/WarsPanel';

type Tab = 'world' | 'research' | 'economy' | 'generals' | 'diplomacy';
const TABS: { id: Tab; label: string }[] = [
  { id: 'world', label: 'World' },
  { id: 'research', label: 'Research' },
  { id: 'economy', label: 'Economy' },
  { id: 'generals', label: 'Generals' },
  { id: 'diplomacy', label: 'Diplomacy' },
];

const ZERO = { money: 0, food: 0, oil: 0, steel: 0, electronics: 0, rare: 0, manpower: 0 };

interface Props {
  campaignId: string;
  onLeave: () => void;
  onLogout: () => void;
}

export function GamePage({ campaignId, onLeave, onLogout }: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('world');
  const [selected, setSelected] = useState<string | null>(null);

  // Move mode: pick an army, then click a destination on the map.
  const [moveFormationId, setMoveFormationId] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string[] | null>(null);

  const { data: state, error, dataUpdatedAt } = useQuery({
    queryKey: ['state', campaignId],
    queryFn: () => api.state(campaignId),
    refetchInterval: 30_000,
  });

  // Live updates: the server says "something changed", we refetch what the screen shows.
  useEffect(() => {
    const socket = getSocket();
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['state', campaignId] });
        qc.invalidateQueries({ queryKey: ['province', campaignId] });
        qc.invalidateQueries({ queryKey: ['battles', campaignId] });
        qc.invalidateQueries({ queryKey: ['wars', campaignId] });
      }, 200);
    };
    const onNotification = () => qc.invalidateQueries({ queryKey: ['notifications', campaignId] });
    socket.on('campaign:update', refresh);
    socket.on('notification', onNotification);
    return () => {
      window.clearTimeout(timer);
      socket.off('campaign:update', refresh);
      socket.off('notification', onNotification);
    };
  }, [campaignId, qc]);

  const balance = useProjectedBalance({
    balance: state?.resources.balance ?? ZERO,
    rates: state?.resources.rates ?? ZERO,
    receivedAt: dataUpdatedAt || Date.now(),
    gameSpeed: state?.campaign.gameSpeed ?? 1,
  });

  // How far the browser clock is from the server clock, so army markers follow the server.
  const clockOffsetMs = useMemo(
    () => (state && dataUpdatedAt ? Date.parse(state.serverTime) - dataUpdatedAt : 0),
    [state, dataUpdatedAt],
  );

  const moveFormation = state?.formations.find((f) => f.id === moveFormationId) ?? null;

  const startMove = (formationId: string) => {
    setTab('world');
    setMoveFormationId(formationId);
    setDest(null);
    setPreviewPath(null);
  };
  const cancelMove = () => {
    setMoveFormationId(null);
    setDest(null);
    setPreviewPath(null);
  };

  // In move mode a map click chooses the destination instead of selecting a province.
  const handleMapSelect = (key: string | null) => {
    if (moveFormation) {
      if (key) setDest(key);
      return;
    }
    setSelected(key);
  };

  if (error) {
    return (
      <div className="center">
        <div className="card">
          <p className="error">{(error as Error).message}</p>
          <button onClick={onLeave}>Back to lobby</button>
        </div>
      </div>
    );
  }
  if (!state) return <div className="center">Loading campaign…</div>;

  const myCountry = state.countries.find((c) => c.id === state.me.countryId);
  const selectProvince = (key: string) => {
    cancelMove();
    setSelected(key);
    setTab('world');
  };

  return (
    <div className="game">
      <header className="topbar">
        <strong>{myCountry?.name ?? 'Cold War 1947'}</strong>
        <span className="muted small">
          {state.campaign.name}
          {state.campaign.gameSpeed !== 1 ? ` · speed x${state.campaign.gameSpeed}` : ''}
        </span>
        <span className="spacer" />
        <button onClick={onLeave}>Lobby</button>
        <button onClick={onLogout}>Log out</button>
      </header>

      <ResourceBar
        balance={state.resources.balance}
        rates={state.resources.rates}
        receivedAt={dataUpdatedAt || Date.now()}
        gameSpeed={state.campaign.gameSpeed}
      />

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="game-body">
        {tab === 'world' && (
          <>
            <div className="map-wrap">
              <WorldMap
                provinces={state.provinces}
                countries={state.countries}
                myCountryId={state.me.countryId}
                atWarWith={state.atWarWith}
                selectedKey={moveFormation ? dest : selected}
                onSelect={handleMapSelect}
                formations={state.formations}
                clockOffsetMs={clockOffsetMs}
                previewPath={previewPath}
              />
              <div className="map-hint muted small">
                {moveFormation
                  ? 'Click the destination province'
                  : 'Drag to pan · scroll to zoom · click a province'}
              </div>
            </div>
            <aside className="sidebar">
              {moveFormation ? (
                <MovePanel
                  key={moveFormation.id}
                  campaignId={campaignId}
                  state={state}
                  formation={moveFormation}
                  dest={dest}
                  onPreview={setPreviewPath}
                  onClose={cancelMove}
                />
              ) : selected ? (
                <ProvincePanel
                  campaignId={campaignId}
                  state={state}
                  provinceKey={selected}
                  balance={balance}
                  onStartMove={startMove}
                />
              ) : (
                <div className="card">
                  <h2>Select a province</h2>
                  <p className="muted small">
                    Click any province on the map to see its production, buildings and forces. Gold outline = your
                    provinces. ⚔ units · ▣ buildings · ⏳ under construction. Gold lines show armies on the march.
                  </p>
                </div>
              )}
              <ArmiesPanel
                campaignId={campaignId}
                formations={state.formations}
                activeId={moveFormationId}
                onMove={startMove}
                onFocus={selectProvince}
              />
              <BattlesPanel campaignId={campaignId} myCountryId={state.me.countryId} />
              <NotificationsPanel campaignId={campaignId} />
            </aside>
          </>
        )}

        {tab === 'economy' && <EconomyPanel state={state} balance={balance} onSelectProvince={selectProvince} />}

        {tab === 'research' && <ComingSoon title="Research" text="Five research branches, timers, universities and laboratories." />}
        {tab === 'generals' && <ComingSoon title="Generals" text="Named historical commanders, abilities, levels and collectibles." />}
        {tab === 'diplomacy' && <WarsPanel campaignId={campaignId} state={state} />}
      </div>
    </div>
  );
}

function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <div className="panel-page">
      <section className="card">
        <h2>{title}</h2>
        <p className="muted">{text}</p>
        <p className="muted small">Planned for a later update of the roadmap — not part of this build yet.</p>
      </section>
    </div>
  );
}
