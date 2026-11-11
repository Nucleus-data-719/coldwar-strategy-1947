import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { FormationDto } from '@cw/shared';
import { api } from '../../services/api';

interface Props {
  campaignId: string;
  formation: FormationDto;
  gameSpeed: number;
  /** Real seconds until the army arrives with no extra delay. */
  etaSeconds: number;
  onClose: () => void;
  onDone: () => void;
}

const MAX_HOURS = 24;

/** "Delay movement": hold the army where it stands for a while, so its arrival is pushed back by the same time. */
export function DelayDialog({ campaignId, formation, gameSpeed, etaSeconds, onClose, onDone }: Props) {
  const [hours, setHours] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const held = !!formation.movement?.holdUntil;
  const realSeconds = (hours * 3600) / Math.max(1, gameSpeed);
  const arrival = new Date(Date.now() + (etaSeconds + realSeconds) * 1000).toLocaleTimeString([], { hour12: false });
  const send = useMutation({
    mutationFn: (h: number) => api.delayFormation(campaignId, formation.id, h),
    onSuccess: onDone,
    onError: (e) => setError((e as Error).message),
  });
  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Delay movement" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>DELAY MOVEMENT</h2>
          <button className="ob-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dialog-body">
          <p className="small">Set or cancel a delay for this army. It waits where it is, then carries on, so it reaches its objective later.</p>
          <p className="muted small">Hint: delay several armies by different amounts to make them arrive together.</p>
          <p className="small">{hours === 0 ? "Don't wait" : `Wait ${hours} game hour${hours === 1 ? '' : 's'}`}</p>
          <input type="range" min={0} max={MAX_HOURS} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="dialog-slider" />
          <p className="small">
            <span className="muted">New Arrival Time:</span> <strong>{arrival}</strong>
          </p>
          {error && <p className="error small">{error}</p>}
          <div className="row">
            <button className="primary" disabled={send.isPending || hours === 0} onClick={() => send.mutate(hours)}>
              Set Delay
            </button>
            <button disabled={send.isPending || !held} onClick={() => send.mutate(0)}>
              Cancel Delay
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
