import { useEffect, useState } from 'react';
import { getAudioSettings, setAudio, subscribeAudio } from '../services/audio';
import { Icon } from './Icon';

/** Two small toggles for the top bar: sound effects and music. */
export function SoundControls() {
  const [s, setS] = useState(getAudioSettings());
  useEffect(() => subscribeAudio(() => setS({ ...getAudioSettings() })), []);
  return (
    <>
      <button
        className={s.sfx ? 'ghost icon' : 'ghost icon off'}
        data-tip={s.sfx ? 'Sound effects on' : 'Sound effects off'}
        data-tip-pos="below"
        aria-label="Toggle sound effects"
        aria-pressed={s.sfx}
        onClick={() => setAudio({ sfx: !s.sfx })}
      >
        <Icon name={s.sfx ? 'sound' : 'soundOff'} />
      </button>
      <button
        className={s.music ? 'ghost icon' : 'ghost icon off'}
        data-tip={s.music ? 'Music on' : 'Music off'}
        data-tip-pos="below"
        aria-label="Toggle music"
        aria-pressed={s.music}
        onClick={() => setAudio({ music: !s.music })}
      >
        <Icon name="music" />
      </button>
    </>
  );
}
