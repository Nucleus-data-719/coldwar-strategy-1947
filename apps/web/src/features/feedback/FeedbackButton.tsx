import { Icon } from '../../components/Icon';
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../services/api';

// Remember the last few browser errors so a bug report arrives with them attached.
const recentErrors: string[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    recentErrors.push(`${new Date().toISOString()} ${e.message}`);
    if (recentErrors.length > 8) recentErrors.shift();
  });
  window.addEventListener('unhandledrejection', (e) => {
    recentErrors.push(`${new Date().toISOString()} unhandled: ${String(e.reason)}`);
    if (recentErrors.length > 8) recentErrors.shift();
  });
}

export function FeedbackButton({ campaignId, details }: { campaignId?: string; details: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [done, setDone] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const send = useMutation({
    mutationFn: () =>
      api.feedback(text, campaignId, {
        ...details,
        userAgent: navigator.userAgent,
        screen: `${window.innerWidth}x${window.innerHeight}`,
        errors: recentErrors,
      }),
    onSuccess: () => {
      setText('');
      setDone(true);
      timer.current = window.setTimeout(() => {
        setDone(false);
        setOpen(false);
      }, 1500);
    },
  });

  if (!open) return <button className="ghost icon" data-tip="Report a problem" data-tip-pos="below" aria-label="Report a problem" onClick={() => setOpen(true)}>
      <Icon name="report" />
    </button>;
  return (
    <div className="card feedback-box">
      <div className="row between">
        <h2>Report a problem</h2>
        <button className="link" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <p className="muted small">What went wrong or what confused you? The screen you are on is attached automatically.</p>
      <textarea className="feedback" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
      {send.error && <p className="error small">{(send.error as Error).message}</p>}
      {done ? (
        <p className="small">Thanks, sent.</p>
      ) : (
        <button className="primary" disabled={text.trim().length < 3 || send.isPending} onClick={() => send.mutate()}>
          Send
        </button>
      )}
    </div>
  );
}
