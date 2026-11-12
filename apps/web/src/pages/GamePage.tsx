import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { DIPLOMACY_COLORS, RESOURCE_COLORS, SUPPLY_COLORS, TERRAIN_COLORS, WorldMap, type MapMode } from '../features/world-map/WorldMap';
import { ResourceBar, useProjectedBalance } from '../features/economy/ResourceBar';
import { ProvincePanel } from '../features/economy/ProvincePanel';
import { EconomyPanel } from '../features/economy/EconomyPanel';
import { Crest, Icon, type IconName } from '../components/Icon';
import { Flag } from '../components/art';
import { Tutorial, isTutorialDismissed, type StepId } from '../features/tutorial/Tutorial';
import { SUPPLY_PENALTY_PERCENT, UNITS, type FormationDto } from '@cw/shared';
import { SoundControls } from '../components/SoundControls';
import { playSfx, sfxForNotification } from '../services/audio';
import { verdict } from '../features/military/BattlesPanel';
import { NotificationsPanel, useUnreadCount } from '../features/economy/NotificationsPanel';
import { ArmyBar, type OrderKind } from '../features/military/ArmyBar';
import { ArmiesPanel } from '../features/military/ArmiesPanel';
import { MovePanel } from '../features/military/MovePanel';
import { NavalPanel } from '../features/military/NavalPanel';
import { BattlesPanel } from '../features/military/BattlesPanel';
import { FeedbackButton } from '../features/feedback/FeedbackButton';
import { ResearchPanel } from '../features/research/ResearchPanel';
import { GeneralsPanel } from '../features/generals/GeneralsPanel';
import { DiplomacyPanel } from '../features/diplomacy/DiplomacyPanel';

type Tab = 'world' | 'research' | 'economy' | 'generals' | 'diplomacy';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'world', label: 'World', icon: 'world' },
  { id: 'economy', label: 'Economy', icon: 'economy' },
  { id: 'research', label: 'Research', icon: 'research' },
  { id: 'generals', label: 'Generals', icon: 'generals' },
  { id: 'diplomacy', label: 'Diplomacy', icon: 'diplomacy' },
];

type DrawerTab = 'province' | 'armies' | 'battles' | 'alerts';
const DRAWER_TABS: { id: DrawerTab; label: string }[] = [
  { id: 'province', label: 'Province' },
  { id: 'armies', label: 'Armies' },
  { id: 'battles', label: 'Battles' },
  { id: 'alerts', label: 'Alerts' },
];

const ZERO = { money: 0, food: 0, oil: 0, steel: 0, electronics: 0, rare: 0, wood: 0, manpower: 0 };

interface Props {
  campaignId: string;
  onLeave: () => void;
  onLogout: () => void;
}

export function GamePage({ campaignId, onLeave, onLogout }: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('world');
  const [selected, setSelected] = useState<string | null>(null);
  // The army selected on the map. Right-click a province to order it there.
  const [armyId, setArmyId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('political');
  const [tutorialOpen, setTutorialOpen] = useState(() => !isTutorialDismissed(campaignId));
  const [everSelected, setEverSelected] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('province');
  const unread = useUnreadCount(campaignId);

  // The diplomacy overlay colours countries by how they feel about you.
  const diplomacy = useQuery({
    queryKey: ['diplomacy', campaignId],
    queryFn: () => api.diplomacy(campaignId),
    enabled: mapMode === 'diplomacy',
  });
  const relationByCountry = useMemo(
    () => Object.fromEntries((diplomacy.data?.countries ?? []).map((c) => [c.countryId, c.stage])),
    [diplomacy.data],
  );

  // A new battle report plays a battle sound, followed by a victory or defeat sting for your own fights.
  const battles = useQuery({ queryKey: ['battles', campaignId], queryFn: () => api.battles(campaignId) });
  const lastBattle = useRef<string | null | undefined>(undefined);
  const topBattle = battles.data?.[0];
  useEffect(() => {
    if (!battles.data) return;
    const id = topBattle?.id ?? null;
    if (lastBattle.current !== undefined && id && id !== lastBattle.current && topBattle) {
      playSfx('battle');
      const mine = state?.me.countryId;
      if (mine && (topBattle.attacker.countryId === mine || topBattle.defender.countryId === mine)) {
        window.setTimeout(() => playSfx(verdict(topBattle, mine) === 'Victory' ? 'victory' : 'defeat'), 700);
      }
    }
    lastBattle.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topBattle?.id, battles.data]);

  // Move mode: pick an army, then click a destination on the map.
  const [moveFormationId, setMoveFormationId] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string[] | null>(null);
  const [previewPatrol, setPreviewPatrol] = useState<{ key: string; radius: number } | null>(null);
  // Naval orders: the order panel for ships, an open-sea dot, an enemy fleet, and the planned sea route.
  const [navalMode, setNavalMode] = useState(false);
  const [orderKind, setOrderKind] = useState<OrderKind>('move');
  const [seaDest, setSeaDest] = useState<number | null>(null);
  const [enemyTarget, setEnemyTarget] = useState<string | null>(null);
  const [previewSea, setPreviewSea] = useState<number[] | null>(null);

  const { data: state, error, dataUpdatedAt } = useQuery({
    queryKey: ['state', campaignId],
    queryFn: () => api.state(campaignId),
    refetchInterval: 30_000,
  });

  // Live updates: the server says "something changed", we refetch what the screen shows.
  useEffect(() => {
    const socket = getSocket();
    let timer: number | undefined;
    // Throttled, not debounced: with 150 AI countries something changes every few seconds, and a
    // debounce would either never fire or refetch the whole map on every message. One refresh per 1.5 s at most.
    const refresh = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        qc.invalidateQueries({ queryKey: ['state', campaignId] });
        qc.invalidateQueries({ queryKey: ['province', campaignId] });
        qc.invalidateQueries({ queryKey: ['battles', campaignId] });
        qc.invalidateQueries({ queryKey: ['wars', campaignId] });
        qc.invalidateQueries({ queryKey: ['generals', campaignId] });
        qc.invalidateQueries({ queryKey: ['diplomacy', campaignId] });
      }, 1500);
    };
    const onNotification = (n?: { type?: string }) => {
      qc.invalidateQueries({ queryKey: ['notifications', campaignId] });
      playSfx(sfxForNotification(n?.type ?? ''));
    };
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
  const selectedArmy = state?.formations.find((f) => f.id === armyId) ?? null;
  // With an army selected the side panel shows only that army, like the army screen in Supremacy.
  const armyMode = !!(moveFormation || selectedArmy);

  const hasShips = (f?: FormationDto | null) => !!f && f.units.some((u) => UNITS[u.unitType].category === 'naval');
  const navalFirst = (f?: FormationDto | null) => !!f && hasShips(f) && (!!f.sea || f.units.every((u) => UNITS[u.unitType].category === 'naval'));
  const startMove = (formationId: string, naval?: boolean, kind: OrderKind = 'move') => {
    setOrderKind(kind);
    const f = state?.formations.find((x) => x.id === formationId);
    setNavalMode(naval ?? navalFirst(f));
    setSeaDest(null);
    setEnemyTarget(null);
    setPreviewSea(null);
    setTab('world');
    setDrawerOpen(true);
    setDrawerTab('province');
    setMoveFormationId(formationId);
    setArmyId(formationId);
    setDest(null);
    setPreviewPath(null);
  };
  const cancelMove = () => {
    setSeaDest(null);
    setEnemyTarget(null);
    setPreviewSea(null);
    setMoveFormationId(null);
    setDest(null);
    setPreviewPath(null);
  };

  // In move mode a map click chooses the destination instead of selecting a province.
  const handleMapSelect = (key: string | null) => {
    if (moveFormation) {
      if (key) {
        setDest(key);
        setSeaDest(null);
        setEnemyTarget(null);
      }
      return;
    }
    setArmyId(null);
    setSelected(key);
    if (key) {
      setEverSelected(true);
      playSfx('select');
      setDrawerOpen(true);
      setDrawerTab('province');
    }
  };

  const clickArmy = (id: string) => {
    playSfx('select');
    cancelMove();
    setArmyId(id);
    setDrawerOpen(true);
    setDrawerTab('province');
  };
  // Right-click: order the selected army to that province (shows the route to confirm).
  const orderArmy = (key: string) => {
    const id = moveFormationId ?? armyId;
    if (!id) return;
    const f0 = state?.formations.find((x) => x.id === id);
    setNavalMode(moveFormationId ? navalMode : navalFirst(f0));
    if (!moveFormationId) {
      const owner = state?.provinces.find((p) => p.key === key)?.ownerCountryId;
      setOrderKind(owner && state?.atWarWith.includes(owner) ? 'attack' : 'move');
    }
    setSeaDest(null);
    setEnemyTarget(null);
    setTab('world');
    setDrawerOpen(true);
    setDrawerTab('province');
    setMoveFormationId(id);
    setArmyId(id);
    setDest(key);
    setPreviewPath(null);
  };

  // Right-click on open sea / an enemy fleet with a fleet selected: plan a sail or attack order.
  const orderSea = (node: number) => {
    const id = moveFormationId ?? armyId;
    const f0 = state?.formations.find((x) => x.id === id);
    if (!id || !hasShips(f0)) return;
    setTab('world');
    setDrawerOpen(true);
    setDrawerTab('province');
    setNavalMode(true);
    setMoveFormationId(id);
    setArmyId(id);
    setDest(null);
    setEnemyTarget(null);
    setSeaDest(node);
  };
  const orderEnemy = (enemyId: string) => {
    const id = moveFormationId ?? armyId;
    const f0 = state?.formations.find((x) => x.id === id);
    if (!id || !hasShips(f0)) return;
    setTab('world');
    setDrawerOpen(true);
    setDrawerTab('province');
    setNavalMode(true);
    setMoveFormationId(id);
    setArmyId(id);
    setDest(null);
    setSeaDest(null);
    setEnemyTarget(enemyId);
  };
  const clickEnemy = (enemyId: string) => {
    const f0 = state?.formations.find((x) => x.id === (moveFormationId ?? armyId));
    if (hasShips(f0)) orderEnemy(enemyId);
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
    setEverSelected(true);
    setTab('world');
    setDrawerOpen(true);
    setDrawerTab('province');
  };

  return (
    <div className="game">
      <header className="hud">
        <div className="hud-id">
          {myCountry ? <Flag code={myCountry.code} color={myCountry.color} width={42} /> : <Crest size={36} />}
          <div className="hud-title">
            <strong>{myCountry?.name ?? 'Cold War 1947'}</strong>
            <span>{state.campaign.name}</span>
          </div>
          {state.campaign.gameSpeed !== 1 && <span className="pill">Speed x{state.campaign.gameSpeed}</span>}
        </div>

        <ResourceBar
          balance={state.resources.balance}
          rates={state.resources.rates}
          shortages={state.resources.shortages}
          breakdown={state.resources.breakdown}
          receivedAt={dataUpdatedAt || Date.now()}
          gameSpeed={state.campaign.gameSpeed}
        />

        <div className="hud-actions">
          <button
            className="ghost icon"
            data-tip={unread ? `${unread} unread alerts` : 'Alerts'}
            data-tip-pos="below"
            aria-label="Alerts"
            onClick={() => {
              setTab('world');
              setDrawerOpen(true);
              setDrawerTab('alerts');
            }}
          >
            <Icon name="bell" />
            {unread > 0 && <span className="badge bell-count">{unread > 99 ? '99+' : unread}</span>}
          </button>
          <button
            className="ghost icon"
            data-tip="Orders from HQ: the guided tutorial"
            data-tip-pos="below"
            aria-label="Show the tutorial"
            onClick={() => setTutorialOpen(true)}
          >
            <Icon name="help" />
          </button>
          <SoundControls />
          <FeedbackButton
            campaignId={campaignId}
            details={{ tab, selected, mapMode, country: myCountry?.code, stateAt: state.serverTime }}
          />
        </div>
      </header>

      <nav className="rail" aria-label="Main">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'nav-btn active' : 'nav-btn'}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <Icon name={t.icon} size={22} />
            {t.label}
          </button>
        ))}
        <span className="rail-sep" />
        <button className="nav-btn" onClick={onLeave} data-tip="Back to the lobby" data-tip-pos="right">
          <Icon name="back" size={22} />
          Lobby
        </button>
        <button className="nav-btn" onClick={onLogout} data-tip="Sign out" data-tip-pos="right">
          <Icon name="logout" size={22} />
          Exit
        </button>
      </nav>

      <div className="game-body">
        {tab === 'world' && (
          <>
            <div className="map-wrap">
              <WorldMap
                provinces={state.provinces}
                countries={state.countries}
                myCountryId={state.me.countryId}
                mode={mapMode}
                atWarWith={state.atWarWith}
                selectedKey={moveFormation ? dest : selected}
                onSelect={handleMapSelect}
                formations={state.formations}
                clockOffsetMs={clockOffsetMs}
                previewPath={previewPath}
                previewPatrol={previewPatrol}
                previewNaval={!!moveFormation && navalMode}
                enemies={state.enemies}
                mines={state.mines}
                onEnemyClick={clickEnemy}
                onEnemyOrder={orderEnemy}
                onSeaOrder={orderSea}
                previewSea={previewSea}
                selectedEnemyId={enemyTarget}
                relationByCountry={relationByCountry}
                selectedArmyId={armyId}
                onArmyClick={clickArmy}
                onOrder={orderArmy}
                supplyShort={state.resources.shortages.some((k) => (SUPPLY_PENALTY_PERCENT[k] ?? 0) > 0)}
              />
              <div className="map-modes">
                {(['political', 'resources', 'terrain', 'supply', 'diplomacy'] as MapMode[]).map((m) => (
                  <button key={m} className={mapMode === m ? 'active' : ''} onClick={() => setMapMode(m)}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
              {mapMode !== 'political' && (
                <div className="map-legend small">
                  {Object.entries(
                    mapMode === 'terrain'
                      ? TERRAIN_COLORS
                      : mapMode === 'supply'
                        ? SUPPLY_COLORS
                        : mapMode === 'diplomacy'
                          ? DIPLOMACY_COLORS
                          : RESOURCE_COLORS,
                  ).map(([name, color]) => (
                    <span key={name}>
                      <i style={{ background: '#' + color.toString(16).padStart(6, '0') }} /> {name}
                    </span>
                  ))}
                </div>
              )}
              {!drawerOpen && (
                <button className="map-open primary" onClick={() => setDrawerOpen(true)}>
                  <Icon name="province" size={18} /> Details
                </button>
              )}
              <div className={moveFormation ? 'map-hint small move' : 'map-hint muted small'}>
                {moveFormation
                  ? 'Click the destination province'
                  : 'Drag to pan · scroll to zoom · click a province or an army · right-click to order'}
              </div>
            </div>
            {selectedArmy && (
              <ArmyBar
                key={selectedArmy.id}
                campaignId={campaignId}
                state={state}
                formation={selectedArmy}
                active={moveFormation ? { kind: orderKind, naval: navalMode } : null}
                onOrder={(kind, naval) => startMove(selectedArmy.id, naval, kind)}
                onClose={() => {
                  cancelMove();
                  setArmyId(null);
                }}
              />
            )}
            {drawerOpen && !(selectedArmy && !moveFormation) && (
              <aside className="drawer" aria-label="Details">
                <div className="drawer-head">
                  {armyMode ? (
                    <strong className="drawer-title">Army</strong>
                  ) : (
                    <div className="seg" role="tablist">
                      {DRAWER_TABS.map((t) => (
                        <button
                          key={t.id}
                          role="tab"
                          className={drawerTab === t.id ? 'active' : ''}
                          onClick={() => setDrawerTab(t.id)}
                        >
                          {t.label}
                          {t.id === 'alerts' && unread > 0 && <span className="badge">{unread}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    className="ghost icon"
                    aria-label="Close panel"
                    data-tip="Close"
                    data-tip-pos="below"
                    onClick={() => {
                      if (armyMode) {
                        cancelMove();
                        setArmyId(null);
                      } else setDrawerOpen(false);
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <div className="drawer-body">
                  {(armyMode || drawerTab === 'province') &&
                    (moveFormation && navalMode ? (
                      <NavalPanel
                        key={moveFormation.id}
                        campaignId={campaignId}
                        state={state}
                        formation={moveFormation}
                        dest={dest}
                        seaDest={seaDest}
                        enemyId={enemyTarget}
                        onPreviewSea={setPreviewSea}
                        onClose={cancelMove}
                      />
                    ) : moveFormation ? (
                      <MovePanel
                        key={moveFormation.id}
                        campaignId={campaignId}
                        state={state}
                        formation={moveFormation}
                        dest={dest}
                        kind={orderKind}
                        onPreview={setPreviewPath}
                        onPatrolPreview={setPreviewPatrol}
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
                          provinces. Gold lines show armies on the march.
                        </p>
                      </div>
                    ))}
                  {!armyMode && drawerTab === 'armies' && (
                    <ArmiesPanel
                      campaignId={campaignId}
                      formations={state.formations}
                      activeId={moveFormationId}
                      onMove={startMove}
                      onFocus={selectProvince}
                    />
                  )}
                  {!armyMode && drawerTab === 'battles' && <BattlesPanel campaignId={campaignId} myCountryId={state.me.countryId} />}
                  {!armyMode && drawerTab === 'alerts' && <NotificationsPanel campaignId={campaignId} />}
                </div>
              </aside>
            )}
          </>
        )}

        {tab === 'economy' && (
          <div className="page-scroll">
            <EconomyPanel state={state} balance={balance} onSelectProvince={selectProvince} />
          </div>
        )}

        {tab === 'research' && (
          <div className="page-scroll">
            <ResearchPanel campaignId={campaignId} state={state} balance={balance} />
          </div>
        )}
        {tab === 'generals' && (
          <div className="page-scroll">
            <GeneralsPanel campaignId={campaignId} state={state} />
          </div>
        )}
        {tab === 'diplomacy' && (
          <div className="page-scroll">
            <DiplomacyPanel campaignId={campaignId} state={state} />
          </div>
        )}
      </div>

      <Tutorial
        campaignId={campaignId}
        state={state}
        hasSelected={everSelected}
        open={tutorialOpen}
        onOpenChange={setTutorialOpen}
        onShow={(id: StepId) => {
          const capital = myCountry?.capitalProvinceKey;
          if (id === 'select' || id === 'build') {
            if (capital) selectProvince(capital);
          } else if (id === 'war') {
            setTab('diplomacy');
          }
        }}
      />
    </div>
  );
}
