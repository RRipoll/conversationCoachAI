/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import cn from 'classnames';

import { memo, useEffect, useState } from 'react';
import { AudioRecorder } from '../../../lib/audio-recorder';
import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';

function ControlTray() {
  const [audioRecorder] = useState(() => new AudioRecorder());
  const { client, connected, connect, disconnect } = useLiveAPIContext();

  useEffect(() => {
    const onData = (base64: string) => {
      client.sendRealtimeInput([
        {
          mimeType: 'audio/pcm;rate=16000',
          data: base64,
        },
      ]);
    };
    if (connected && audioRecorder) {
      audioRecorder.on('data', onData);
      audioRecorder.start();
    } else {
      audioRecorder.stop();
    }
    return () => {
      audioRecorder.off('data', onData);
    };
  }, [connected, client, audioRecorder]);

  const handleMicClick = () => {
    if (connected) {
      disconnect();
    } else {
      connect();
    }
  };

  const micButtonTitle = connected
    ? 'Stop conversation'
    : 'Start conversation';

  return (
    <section className="control-tray">
      <nav className={cn('actions-nav')}>
        <button
          className={cn('action-button mic-button', { connected })}
          onClick={handleMicClick}
          title={micButtonTitle}
        >
          {connected ? (
            <span className="material-symbols-outlined filled">mic</span>
          ) : (
            <span className="material-symbols-outlined filled">mic_off</span>
          )}
        </button>
      </nav>
    </section>
  );
}

export default memo(ControlTray);
