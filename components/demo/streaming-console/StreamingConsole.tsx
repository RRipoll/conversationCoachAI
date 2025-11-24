
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useEffect, useRef, useState } from 'react';
import PopUp from '../popup/PopUp';
import WelcomeScreen from '../welcome-screen/WelcomeScreen';
// FIX: Import LiveServerContent to correctly type the content handler.
import {
  GoogleGenAI,
  LiveServerContent,
  Type,
  Modality,
} from '@google/genai';

import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import {
  useSettings,
  useLogStore,
  usePrompts,
  ConversationTurn,
  PronunciationFeedback,
  GrammarFeedback,
} from '@/lib/state';
import { base64ToArrayBuffer, decodeAudioData } from '@/lib/utils';

const formatTimestamp = (date: Date) => {
  const pad = (num: number, size = 2) => num.toString().padStart(size, '0');
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const milliseconds = pad(date.getMilliseconds(), 3);
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
};

const renderContent = (text: string) => {
  // Split by ```json...``` code blocks
  const parts = text.split(/(`{3}json\n[\s\S]*?\n`{3})/g);

  return parts.map((part, index) => {
    if (part.startsWith('```json')) {
      const jsonContent = part.replace(/^`{3}json\n|`{3}$/g, '');
      return (
        <pre key={index}>
          <code>{jsonContent}</code>
        </pre>
      );
    }

    // Split by **bold** text
    const boldParts = part.split(/(\*\*.*?\*\*)/g);
    return boldParts.map((boldPart, boldIndex) => {
      if (boldPart.startsWith('**') && boldPart.endsWith('**')) {
        return <strong key={boldIndex}>{boldPart.slice(2, -2)}</strong>;
      }
      return boldPart;
    });
  });
};


export default function StreamingConsole() {
  const { client, setConfig, connected, connect, disconnect } = useLiveAPIContext();
  const { systemPrompt, voice } = useSettings();
  const { topics, customTopics } = usePrompts();
  const turns = useLogStore(state => state.turns);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showPopUp, setShowPopUp] = useState(true);
  const [ai, setAi] = useState<GoogleGenAI | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [playingTurnId, setPlayingTurnId] = useState<string | null>(null);
  const fetchingFeedbackRef = useRef(new Set<string>());

  // Practice Mode State
  const [targetText, setTargetText] = useState("");
  const [targetIpa, setTargetIpa] = useState("");
  const [isPracticePlaying, setIsPracticePlaying] = useState(false);
  const [manualTopic, setManualTopic] = useState("");
  const targetTextRef = useRef(targetText);
  const practiceSourceRef = useRef<AudioBufferSourceNode | null>(null);
  
  // Refs for TTS Pause/Resume
  const practiceAudioBufferRef = useRef<AudioBuffer | null>(null);
  const practiceStartTimeRef = useRef<number>(0);
  const practicePausedAtRef = useRef<number>(0);
  const isPausedIntentRef = useRef<boolean>(false);

  useEffect(() => {
    targetTextRef.current = targetText;
    // Reset audio buffer and state if text changes
    if (practiceAudioBufferRef.current) {
      if (isPracticePlaying && practiceSourceRef.current) {
        isPausedIntentRef.current = false; // Treat as full stop
        try {
          practiceSourceRef.current.stop();
        } catch (e) {
          // ignore
        }
      }
      practiceAudioBufferRef.current = null;
      practicePausedAtRef.current = 0;
      setIsPracticePlaying(false);
    }
  }, [targetText]);


  useEffect(() => {
    const apiKey = process.env.API_KEY as string;
    if (apiKey) {
      setAi(new GoogleGenAI({ apiKey }));
    } else {
      console.error('Missing API_KEY');
    }
  }, []);


  const handleClosePopUp = () => {
    setShowPopUp(false);
  };

  // Set the configuration for the Live API
  useEffect(() => {
    const enabledTopics = topics
      .filter(topic => topic.isEnabled)
      .map(topic => topic.name);

    const customTopicsList = customTopics
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const allTopics = [...enabledTopics, ...customTopicsList];

    let finalSystemPrompt = systemPrompt;
    if (allTopics.length > 0) {
      finalSystemPrompt += `\n\nPlease focus the conversation on these topics: ${allTopics.join(
        ', ',
      )}.`;
    }

    // Using `any` for config to accommodate `speechConfig`, which is not in the
    // current TS definitions but is used in the working reference example.
    const config: any = {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice,
          },
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction: {
        parts: [
          {
            text: finalSystemPrompt,
          },
        ],
      },
      tools: [],
    };

    setConfig(config);
  }, [setConfig, systemPrompt, topics, voice, customTopics]);

  useEffect(() => {
    const { addTurn, updateLastTurn, updateTurnById } = useLogStore.getState();

    const handleInputTranscription = (text: string, isFinal: boolean) => {
      const turns = useLogStore.getState().turns;
      const last = turns[turns.length - 1];
      if (last && last.role === 'user' && !last.isFinal) {
        updateLastTurn({
          text: last.text + text,
          isFinal,
        });
      } else {
        addTurn({ role: 'user', text, isFinal });
      }
    };

    const handleOutputTranscription = (text: string, isFinal: boolean) => {
      const { turns, addTurn, updateLastTurn, updateTurnById } =
        useLogStore.getState();
      const last = turns[turns.length - 1];
      if (last && last.role === 'agent' && !last.isFinal) {
        updateLastTurn({
          text: last.text + text,
          isFinal,
        });
      } else {
        // A new agent turn is starting. Finalize the previous user turn if it exists.
        if (last && last.role === 'user' && !last.isFinal) {
          updateTurnById(last.id, { isFinal: true });
        }
        addTurn({ role: 'agent', text, isFinal });
      }
    };

    // FIX: The 'content' event provides a single LiveServerContent object.
    // The function signature is updated to accept one argument, and groundingMetadata is extracted from it.
    const handleContent = (serverContent: LiveServerContent) => {
      const text =
        serverContent.modelTurn?.parts
          ?.map((p: any) => p.text)
          .filter(Boolean)
          .join(' ') ?? '';
      const groundingChunks = serverContent.groundingMetadata?.groundingChunks;

      if (!text && !groundingChunks) return;

      const { turns, addTurn, updateLastTurn, updateTurnById } =
        useLogStore.getState();
      // FIX: Replace .at(-1) with [length - 1] for broader TS compatibility.
      const last = turns[turns.length - 1];

      if (last?.role === 'agent' && !last.isFinal) {
        const updatedTurn: Partial<ConversationTurn> = {
          text: last.text + text,
        };
        if (groundingChunks) {
          updatedTurn.groundingChunks = [
            ...(last.groundingChunks || []),
            ...groundingChunks,
          ];
        }
        updateLastTurn(updatedTurn);
      } else {
        // A new agent turn is starting. Finalize the previous user turn if it exists.
        if (last && last.role === 'user' && !last.isFinal) {
          updateTurnById(last.id, { isFinal: true });
        }
        addTurn({ role: 'agent', text, isFinal: false, groundingChunks });
      }
    };

    const handleTurnComplete = async () => {
      const { turns, updateTurnById } = useLogStore.getState();
      // FIX: Replace .at(-1) with [length - 1] for broader TS compatibility.
      const last = turns[turns.length - 1];
      if (last && !last.isFinal) {
        updateTurnById(last.id, { isFinal: true });
      }
    };

    client.on('inputTranscription', handleInputTranscription);
    client.on('outputTranscription', handleOutputTranscription);
    client.on('content', handleContent);
    client.on('turncomplete', handleTurnComplete);

    return () => {
      client.off('inputTranscription', handleInputTranscription);
      client.off('outputTranscription', handleOutputTranscription);
      client.off('content', handleContent);
      client.off('turncomplete', handleTurnComplete);
    };
  }, [client]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  // Fetch pronunciation feedback for finalized user turns
  useEffect(() => {
    if (!ai) return;

    const getPronunciationFeedback = async (turn: ConversationTurn) => {
      if (fetchingFeedbackRef.current.has(turn.id)) return;
      fetchingFeedbackRef.current.add(turn.id);
      const { updateTurnById } = useLogStore.getState();

      try {
        // Set a loading state
        updateTurnById(turn.id, {
          pronunciationFeedback: {
            overall_assessment: 'Analyzing pronunciation...',
            words: [],
          },
        });

        const responseSchema = {
          type: Type.OBJECT,
          properties: {
            overall_assessment: {
              type: Type.STRING,
              description:
                "A brief, encouraging overall assessment of the user's pronunciation.",
            },
            words: {
              type: Type.ARRAY,
              description:
                "A word-by-word analysis of the user's pronunciation.",
              items: {
                type: Type.OBJECT,
                properties: {
                  word: {
                    type: Type.STRING,
                    description: 'The word from the original text.',
                  },
                  accuracy: {
                    type: Type.STRING,
                    description:
                      'Pronunciation accuracy: "good", "needs_improvement", or "incorrect".',
                  },
                  feedback: {
                    type: Type.STRING,
                    description:
                      'Specific feedback for this word. If "good", this can be a simple encouragement.',
                  },
                },
                required: ['word', 'accuracy', 'feedback'],
              },
            },
          },
          required: ['overall_assessment', 'words'],
        };

        const target = targetTextRef.current;
        let prompt = '';

        if (target && target.trim().length > 0) {
          prompt = `You are an expert English pronunciation coach. The user attempted to read the following target text: "${target}". The transcription of what they actually said is: "${turn.text}". 
          
          Analyze their pronunciation by comparing the transcript to the target text. 
          - If the transcript matches the target closely, mark words as "good".
          - If words are missing or different in a way that suggests mispronunciation, mark them as "needs_improvement" or "incorrect".
          - Provide an overall assessment and a word-by-word breakdown of the TARGET text.
          - Respond ONLY with a JSON object that conforms to the provided schema.`;
        } else {
          prompt = `You are an expert English pronunciation coach. Analyze the pronunciation of the following text from a non-native English speaker. Provide an overall assessment and a word-by-word breakdown of every word. Respond ONLY with a JSON object that conforms to the provided schema.

Text to analyze: "${turn.text}"`;
        }

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema,
          },
        });

        const feedbackJson = JSON.parse(response.text) as PronunciationFeedback;
        updateTurnById(turn.id, { pronunciationFeedback: feedbackJson });
      } catch (error) {
        console.error('Pronunciation feedback generation failed:', error);
        updateTurnById(turn.id, { pronunciationFeedback: undefined });
      } finally {
        fetchingFeedbackRef.current.delete(turn.id);
      }
    };

    const lastFinalizedUserTurn = turns
      .slice()
      .reverse()
      .find(
        t =>
          t.role === 'user' &&
          t.isFinal &&
          t.text.trim() &&
          !t.pronunciationFeedback,
      );

    if (lastFinalizedUserTurn) {
      getPronunciationFeedback(lastFinalizedUserTurn);
    }
  }, [turns, ai]);


  const handlePlayTTS = async (turn: ConversationTurn) => {
    if (!ai || playingTurnId) return;
    setPlayingTurnId(turn.id);
    const { updateTurnById } = useLogStore.getState();

    try {
      // Fetch IPA if it doesn't exist for the current turn
      if (!turn.ipa && turn.text.trim()) {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `Provide the International Phonetic Alphabet (IPA) transcription for the following English text. Return only the IPA string, without any surrounding text, labels, or markdown formatting. For example, for "hello world", return "/həˈloʊ wɜːrld/". Text: "${turn.text}"`,
        });
        const ipa = response.text.trim();
        if (ipa) {
          updateTurnById(turn.id, { ipa });
        }
      }

      // Fetch grammar feedback if it doesn't exist for the current user turn
      if (turn.role === 'user' && !turn.grammarFeedback && turn.text.trim()) {
        updateTurnById(turn.id, {
          grammarFeedback: {
            overall_assessment: 'Analyzing grammar...',
            corrections: [],
          },
        });

        const responseSchema = {
          type: Type.OBJECT,
          properties: {
            overall_assessment: {
              type: Type.STRING,
              description: "A brief, encouraging overall assessment of the user's grammar.",
            },
            corrections: {
              type: Type.ARRAY,
              description: "A list of specific grammar corrections. If there are no errors, this should be an empty array.",
              items: {
                type: Type.OBJECT,
                properties: {
                  original: {
                    type: Type.STRING,
                    description: 'The original phrase with the grammatical error.',
                  },
                  corrected: {
                    type: Type.STRING,
                    description: 'The grammatically correct version of the phrase.',
                  },
                  explanation: {
                    type: Type.STRING,
                    description: 'A simple explanation of the grammar rule that was broken.',
                  },
                },
                required: ['original', 'corrected', 'explanation'],
              },
            },
          },
          required: ['overall_assessment', 'corrections'],
        };

        const prompt = `You are an expert English grammar coach. Analyze the grammar of the following text from a non-native English speaker. Provide an overall assessment and a list of corrections. If the text is grammatically perfect, provide a positive assessment and an empty array for corrections. Respond ONLY with a JSON object that conforms to the provided schema.

Text to analyze: "${turn.text}"`;

        try {
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema,
            },
          });
          const feedbackJson = JSON.parse(response.text) as GrammarFeedback;
          updateTurnById(turn.id, { grammarFeedback: feedbackJson });
        } catch (error) {
          console.error('Grammar feedback generation failed:', error);
          updateTurnById(turn.id, { grammarFeedback: undefined });
        }
      }


      // Generate and play TTS audio
      const ttsVoice = turn.role === 'user' ? 'Puck' : voice;
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: turn.text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: ttsVoice },
            },
          },
        },
      });
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const audioCtx = audioContextRef.current;
        const audioData = base64ToArrayBuffer(base64Audio);
        const audioBuffer = await decodeAudioData(audioData, audioCtx, 24000, 1);
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.start();
        source.onended = () => setPlayingTurnId(null);
      } else {
        setPlayingTurnId(null);
      }
    } catch (error) {
      console.error("TTS/IPA/Grammar generation failed:", error);
      updateTurnById(turn.id, { ipa: undefined, grammarFeedback: undefined });
      setPlayingTurnId(null);
    }
  };

  const renderFeedbackText = (turn: ConversationTurn) => {
    if (
      !turn.pronunciationFeedback?.words ||
      turn.pronunciationFeedback.words.length === 0
    ) {
      return renderContent(turn.text);
    }

    return (
      <>
        {turn.pronunciationFeedback.words.map((wordInfo, index) => (
          <span
            key={index}
            className={`word-feedback accuracy-${wordInfo.accuracy.replace(
              /_/g,
              '-',
            )}`}
            data-feedback={wordInfo.feedback}
          >
            {wordInfo.word}{' '}
          </span>
        ))}
      </>
    );
  };

  // Practice Mode Handlers
  const handleGenerateTopic = async () => {
    if (!ai) return;
    try {
      let searchTopic = manualTopic.trim();
      
      if (!searchTopic) {
        const javaSubTopics = [
          "Java 21 features",
          "Spring Boot 3",
          "Java concurrency patterns",
          "Java Garbage Collection tuning",
          "Microservices with Java",
          "Java Stream API",
          "Java Records and Pattern Matching",
          "Java Security best practices",
          "Unit Testing with JUnit 5",
          "Cloud Native Java",
          "Java Virtual Threads (Project Loom)",
          "Java Memory Management",
          "Reactive Programming in Java",
          "Java Design Patterns",
          "Hibernate and JPA",
          "GraalVM and Native Image"
        ];
        searchTopic = javaSubTopics[Math.floor(Math.random() * javaSubTopics.length)];
      }

      setTargetText(`Searching for a topic related to "${searchTopic}"...`);
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Search for interesting or trending topics specifically related to "${searchTopic}". Randomly select one specific concept, tool, or feature from the search results. Write a cohesive, educational paragraph of 100 to 200 words explaining this specific topic. The text should be suitable for reading practice. Do not use bullet points or markdown formatting.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      if (response.text) {
        setTargetText(response.text.trim());
      } else {
        setTargetText("");
      }
    } catch (error) {
      console.error("Failed to generate topic:", error);
      setTargetText("Error fetching topic. Please try again.");
    }
  };

  const handleGetIPA = async () => {
    if (!ai || !targetText) return;
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Provide the International Phonetic Alphabet (IPA) transcription for the following English text. Return only the IPA string, without any surrounding text, labels, or markdown formatting. Text: "${targetText}"`,
      });
      setTargetIpa(response.text.trim());
    } catch (e) {
      console.error("Error fetching IPA", e);
    }
  };

  const handlePracticeMic = async () => {
    if (connected) {
      disconnect();
    } else {
      await connect();
    }
  };

  const handlePracticeTTS = async () => {
    if (!ai || !targetText.trim()) return;

    // Initialize AudioContext if needed
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const audioCtx = audioContextRef.current;
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // --- PAUSE LOGIC ---
    if (isPracticePlaying) {
      if (practiceSourceRef.current) {
        isPausedIntentRef.current = true;
        practiceSourceRef.current.stop();
        // Calculate elapsed time to store for resume
        const elapsed = audioCtx.currentTime - practiceStartTimeRef.current;
        practicePausedAtRef.current += elapsed;
      }
      setIsPracticePlaying(false);
      return;
    }

    // --- PLAY/RESUME LOGIC ---
    setIsPracticePlaying(true);
    isPausedIntentRef.current = false;

    // If buffer is missing (first run or text changed)
    if (!practiceAudioBufferRef.current) {
      practicePausedAtRef.current = 0; // Ensure start from 0
      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: targetText }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice },
              },
            },
          },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
          const audioData = base64ToArrayBuffer(base64Audio);
          const audioBuffer = await decodeAudioData(audioData, audioCtx, 24000, 1);
          practiceAudioBufferRef.current = audioBuffer;
        } else {
          console.error("No audio data returned");
          setIsPracticePlaying(false);
          return;
        }
      } catch (e) {
        console.error("TTS failed", e);
        setIsPracticePlaying(false);
        return;
      }
    }

    // Play the buffer
    if (practiceAudioBufferRef.current) {
      const source = audioCtx.createBufferSource();
      source.buffer = practiceAudioBufferRef.current;
      source.connect(audioCtx.destination);

      // If we are at the end (or slightly over due to float math), restart
      if (practicePausedAtRef.current >= practiceAudioBufferRef.current.duration) {
        practicePausedAtRef.current = 0;
      }

      source.start(0, practicePausedAtRef.current);
      practiceStartTimeRef.current = audioCtx.currentTime;
      practiceSourceRef.current = source;

      source.onended = () => {
        if (isPausedIntentRef.current) {
          // Paused manually: state handled in the pause block above.
        } else {
          // Ended naturally
          setIsPracticePlaying(false);
          practicePausedAtRef.current = 0; // Reset so next click is from start
        }
        practiceSourceRef.current = null;
      };
    }
  };

  const handleClearPractice = () => {
    setTargetText("");
    setTargetIpa("");
    if (practiceSourceRef.current) {
      try {
        isPausedIntentRef.current = false;
        practiceSourceRef.current.stop();
      } catch (e) {
        // ignore errors if already stopped
      }
      practiceSourceRef.current = null;
    }
    setIsPracticePlaying(false);
    practiceAudioBufferRef.current = null;
    practicePausedAtRef.current = 0;
    if (connected) {
      disconnect();
    }
  };

  // Send context when connecting in practice mode
  useEffect(() => {
    if (connected && client && targetTextRef.current) {
      client.send([{ text: `I am practicing reading the following text: "${targetTextRef.current}". Please listen to my pronunciation and provide feedback.` }]);
    }
  }, [connected, client]);

  return (
    <div className="transcription-container">
      {showPopUp && <PopUp onClose={handleClosePopUp} />}
      
      {/* Practice Panel */}
      <div className="practice-panel">
        <div className="practice-header">
           <input 
              type="text" 
              className="topic-input"
              placeholder="Enter a topic (e.g., 'React Hooks') or leave empty for random Java topic"
              value={manualTopic}
              onChange={(e) => setManualTopic(e.target.value)}
           />
           <button
              className="practice-button"
              onClick={handleGenerateTopic}
              title="Search and generate text for the topic"
           >
              <span className="icon">search</span> Generate
           </button>
        </div>
        <div className="practice-input-container">
          <textarea
            className="practice-textarea"
            placeholder="Enter English text to practice pronunciation..."
            value={targetText}
            onChange={(e) => setTargetText(e.target.value)}
            rows={5}
          />
        </div>
        <div className="practice-controls">
           <button 
            className="practice-button" 
            onClick={handleGetIPA}
            disabled={!targetText.trim()}
          >
            <span className="icon">translate</span> Show IPA
          </button>

          <button 
            className="practice-button" 
            onClick={handlePracticeTTS}
            disabled={!targetText.trim()}
            title={isPracticePlaying ? "Pause" : "Listen to pronunciation"}
          >
            <span className="icon">{isPracticePlaying ? 'pause' : 'volume_up'}</span> 
            {isPracticePlaying ? 'Pause' : 'Listen'}
          </button>
          
          <button 
            className={`practice-button mic-toggle ${connected ? 'active' : ''}`} 
            onClick={handlePracticeMic}
            title={connected ? "Stop Recording" : "Read Aloud"}
            disabled={!targetText.trim()}
          >
            <span className="icon">{connected ? 'stop' : 'mic'}</span> 
            {connected ? 'Stop' : 'Read Aloud'}
          </button>

          <button 
            className="practice-button" 
            onClick={handleClearPractice}
            disabled={!targetText && !targetIpa}
            title="Clear text"
          >
            <span className="icon">delete</span> Clear
          </button>
        </div>
        {targetIpa && (
          <div className="practice-ipa-display">
            <span className="ipa-label">IPA:</span> {targetIpa}
          </div>
        )}
      </div>

      {turns.length === 0 && !targetText ? (
        <WelcomeScreen />
      ) : (
        <div className="transcription-view" ref={scrollRef}>
          {turns.map((t, i) => (
            <div
              key={i}
              className={`transcription-entry ${t.role} ${!t.isFinal ? 'interim' : ''
                }`}
            >
              <div className="transcription-header">
                <div className="transcription-source">
                  {t.role === 'user'
                    ? 'You'
                    : t.role === 'agent'
                      ? 'Agent'
                      : 'System'}
                </div>
                <div className="transcription-meta">
                  <div className="transcription-timestamp">
                    {formatTimestamp(t.timestamp)}
                  </div>
                  {(t.role === 'agent' || t.role === 'user') && t.isFinal && t.text.trim() && (
                    <button
                      className="tts-play-button"
                      onClick={() => handlePlayTTS(t)}
                      disabled={!!playingTurnId}
                      aria-label={t.role === 'user' ? "Play audio, show IPA, and check grammar for this message" : "Play audio and show IPA for this message"}
                      title={t.role === 'user' ? "Read aloud, show IPA & check grammar" : "Read aloud and show IPA"}
                    >
                      <span className="icon">
                        {playingTurnId === t.id ? 'hourglass_top' : 'volume_up'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
              <div className="transcription-text-content">
                {t.role === 'user' && t.pronunciationFeedback
                  ? renderFeedbackText(t)
                  : renderContent(t.text)}
              </div>
              {t.ipa && (
                <div className="transcription-ipa-content">{t.ipa}</div>
              )}
              {t.role === 'user' && t.pronunciationFeedback?.overall_assessment && (
                <div className="pronunciation-feedback">
                  <div className="pronunciation-assessment">
                    {t.pronunciationFeedback.overall_assessment}
                  </div>
                </div>
              )}
              {t.role === 'user' && t.grammarFeedback && (
                <div className="grammar-feedback">
                  <h4>Grammar Feedback</h4>
                  <div className="grammar-assessment">
                    {t.grammarFeedback.overall_assessment}
                  </div>
                  {t.grammarFeedback.corrections.length > 0 && (
                    <ul className="grammar-corrections-list">
                      {t.grammarFeedback.corrections.map((c, i) => (
                        <li key={i}>
                          <p>
                            <span className="grammar-original">{c.original}</span> →{' '}
                            <span className="grammar-corrected">{c.corrected}</span>
                          </p>
                          <p className="grammar-explanation">{c.explanation}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {t.groundingChunks && t.groundingChunks.length > 0 && (
                <div className="grounding-chunks">
                  <strong>Sources:</strong>
                  <ul>
                    {t.groundingChunks
                      // FIX: Ensure that the chunk has a web property and a uri before rendering.
                      .filter(chunk => chunk.web && chunk.web.uri)
                      .map((chunk, index) => (
                        <li key={index}>
                          <a
                            href={chunk.web!.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {chunk.web!.title || chunk.web!.uri}
                          </a>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
