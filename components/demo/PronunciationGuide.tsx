
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState } from 'react';
import Modal from '../Modal';
import { GoogleGenAI, Modality } from '@google/genai';
import { base64ToArrayBuffer, decodeAudioData } from '@/lib/utils';
import cn from 'classnames';

interface PronunciationGuideProps {
  onClose: () => void;
}

export default function PronunciationGuide({ onClose }: PronunciationGuideProps) {
  const [playingWord, setPlayingWord] = useState<string | null>(null);
  
  // Initialize AI client
  // Note: In a production app, consider moving this to a context or prop to avoid re-initializing
  const apiKey = process.env.API_KEY as string;
  const ai = new GoogleGenAI({ apiKey });

  const handlePlay = async (word: string) => {
    if (playingWord) return; // Prevent multiple clicks
    setPlayingWord(word);

    try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-tts',
            contents: [{ parts: [{ text: word }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            const buffer = await decodeAudioData(
                base64ToArrayBuffer(base64Audio),
                audioContext,
                24000,
                1
            );
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.onended = () => setPlayingWord(null);
            source.start();
        } else {
            setPlayingWord(null);
        }
    } catch (e) {
        console.error("TTS Error in guide", e);
        setPlayingWord(null);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className="pronunciation-guide">
        <h2>Pronunciation Guide</h2>
        <p className="guide-intro">
          The International Phonetic Alphabet (IPA) represents the sounds of spoken language.
          <strong> Click on any example</strong> to hear the pronunciation.
        </p>

        <section>
          <h3>Vowels (Monophthongs)</h3>
          <div className="guide-grid">
            <div className={cn("guide-item", { playing: playingWord === 'sheep' })} onClick={() => handlePlay('sheep')}><span className="ipa-symbol">iː</span><span className="word-example">sh<strong>ee</strong>p</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'ship' })} onClick={() => handlePlay('ship')}><span className="ipa-symbol">ɪ</span><span className="word-example">sh<strong>i</strong>p</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'good' })} onClick={() => handlePlay('good')}><span className="ipa-symbol">ʊ</span><span className="word-example">g<strong>oo</strong>d</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'shoot' })} onClick={() => handlePlay('shoot')}><span className="ipa-symbol">uː</span><span className="word-example">sh<strong>oo</strong>t</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'bed' })} onClick={() => handlePlay('bed')}><span className="ipa-symbol">e</span><span className="word-example">b<strong>e</strong>d</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'teacher' })} onClick={() => handlePlay('teacher')}><span className="ipa-symbol">ə</span><span className="word-example">teach<strong>er</strong></span></div>
            <div className={cn("guide-item", { playing: playingWord === 'bird' })} onClick={() => handlePlay('bird')}><span className="ipa-symbol">ɜː</span><span className="word-example">b<strong>ir</strong>d</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'door' })} onClick={() => handlePlay('door')}><span className="ipa-symbol">ɔː</span><span className="word-example">d<strong>oo</strong>r</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'cat' })} onClick={() => handlePlay('cat')}><span className="ipa-symbol">æ</span><span className="word-example">c<strong>a</strong>t</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'up' })} onClick={() => handlePlay('up')}><span className="ipa-symbol">ʌ</span><span className="word-example"><strong>u</strong>p</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'far' })} onClick={() => handlePlay('far')}><span className="ipa-symbol">ɑː</span><span className="word-example">f<strong>a</strong>r</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'on' })} onClick={() => handlePlay('on')}><span className="ipa-symbol">ɒ</span><span className="word-example"><strong>o</strong>n</span></div>
          </div>
        </section>

        <section>
          <h3>Diphthongs (Gliding Vowels)</h3>
          <div className="guide-grid">
            <div className={cn("guide-item", { playing: playingWord === 'here' })} onClick={() => handlePlay('here')}><span className="ipa-symbol">ɪə</span><span className="word-example">h<strong>ere</strong></span></div>
            <div className={cn("guide-item", { playing: playingWord === 'wait' })} onClick={() => handlePlay('wait')}><span className="ipa-symbol">eɪ</span><span className="word-example">w<strong>ai</strong>t</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'tourist' })} onClick={() => handlePlay('tourist')}><span className="ipa-symbol">ʊə</span><span className="word-example">t<strong>our</strong>ist</span></div>
            <div className={cn("guide-item", { playing: playingWord === 'boy' })} onClick={() => handlePlay('boy')}><span className="ipa-symbol">ɔɪ</span><span className="word-example">b<strong>oy</strong></span></div>
            <div className={cn("guide-item", { playing: playingWord === 'show' })} onClick={() => handlePlay('show')}><span className="ipa-symbol">əʊ</span><span className="word-example">sh<strong>ow</strong></span></div>
            <div className={cn("guide-item", { playing: playingWord === 'hair' })} onClick={() => handlePlay('hair')}><span className="ipa-symbol">eə</span><span className="word-example">h<strong>air</strong></span></div>
            <div className={cn("guide-item", { playing: playingWord === 'my' })} onClick={() => handlePlay('my')}><span className="ipa-symbol">aɪ</span><span className="word-example">m<strong>y</strong></span></div>
            <div className={cn("guide-item", { playing: playingWord === 'cow' })} onClick={() => handlePlay('cow')}><span className="ipa-symbol">aʊ</span><span className="word-example">c<strong>ow</strong></span></div>
          </div>
        </section>

        <section>
          <h3>Common Consonant Challenges</h3>
          <div className="guide-list">
             <div className={cn("guide-row", { playing: playingWord === 'think' })} onClick={() => handlePlay('think')}>
                <div className="guide-col-symbol"><span className="ipa-symbol">θ</span></div>
                <div className="guide-col-word"><strong>th</strong>ink (unvoiced)</div>
                <div className="guide-col-desc">Place tongue tip between teeth and blow air gently. No vocal cord vibration.</div>
             </div>
             <div className={cn("guide-row", { playing: playingWord === 'this' })} onClick={() => handlePlay('this')}>
                <div className="guide-col-symbol"><span className="ipa-symbol">ð</span></div>
                <div className="guide-col-word"><strong>th</strong>is (voiced)</div>
                <div className="guide-col-desc">Same tongue position as 'θ', but vibrate your vocal cords (make a sound).</div>
             </div>
             <div className={cn("guide-row", { playing: playingWord === 'she' })} onClick={() => handlePlay('she')}>
                <div className="guide-col-symbol"><span className="ipa-symbol">ʃ</span></div>
                <div className="guide-col-word"><strong>sh</strong>e</div>
                <div className="guide-col-desc">Round lips slightly, pull tongue back, and blow air (hushing sound).</div>
             </div>
             <div className={cn("guide-row", { playing: playingWord === 'vision' })} onClick={() => handlePlay('vision')}>
                <div className="guide-col-symbol"><span className="ipa-symbol">ʒ</span></div>
                <div className="guide-col-word">vi<strong>si</strong>on</div>
                <div className="guide-col-desc">Voiced version of 'sh'. Like the 'g' in 'beige'.</div>
             </div>
             <div className={cn("guide-row", { playing: playingWord === 'chips' })} onClick={() => handlePlay('chips')}>
                <div className="guide-col-symbol"><span className="ipa-symbol">tʃ</span></div>
                <div className="guide-col-word"><strong>ch</strong>ips</div>
                <div className="guide-col-desc">Start with 't' tongue position, release quickly into 'sh'. Explosive sound.</div>
             </div>
             <div className={cn("guide-row", { playing: playingWord === 'joy' })} onClick={() => handlePlay('joy')}>
                <div className="guide-col-symbol"><span className="ipa-symbol">dʒ</span></div>
                <div className="guide-col-word"><strong>j</strong>oy</div>
                <div className="guide-col-desc">Voiced version of 'ch'. Like 'd' + 'ʒ'.</div>
             </div>
             <div className={cn("guide-row", { playing: playingWord === 'king' })} onClick={() => handlePlay('king')}>
                <div className="guide-col-symbol"><span className="ipa-symbol">ŋ</span></div>
                <div className="guide-col-word">ki<strong>ng</strong></div>
                <div className="guide-col-desc">Back of tongue touches the soft palate (roof of mouth). Air flows through nose.</div>
             </div>
          </div>
        </section>

        <div className="guide-actions">
            <button onClick={onClose} className="guide-close-btn">Close Guide</button>
        </div>
      </div>
    </Modal>
  );
}
