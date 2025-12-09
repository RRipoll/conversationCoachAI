
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import cn from 'classnames';

import {
  GoogleGenAI,
  LiveServerContent,
  Type,
  Modality,
} from '@google/genai';
import { debounce } from 'lodash';

import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import {
  useSettings,
  useLogStore,
  usePrompts,
  PronunciationFeedback,
} from '@/lib/state';
import { base64ToArrayBuffer, decodeAudioData } from '@/lib/utils';
import { AudioRecorder } from '@/lib/audio-recorder';
import ControlTray from '../../console/control-tray/ControlTray';
import PronunciationGuide from '../PronunciationGuide';
import WelcomeScreen from '../welcome-screen/WelcomeScreen';

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

// --- WAV Helper Functions ---
const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
};

const createWavHeader = (sampleRate: number, dataLength: number, numChannels: number = 1, bitDepth: number = 16) => {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);
    return buffer;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
};
// ----------------------------

export default function StreamingConsole() {
  const { client, setConfig, connected, disconnect } = useLiveAPIContext();
  const { systemPrompt, voice } = useSettings();
  const { topics, customTopics } = usePrompts();
  const turns = useLogStore(state => state.turns);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const [ai, setAi] = useState<GoogleGenAI | null>(null);
  const [activeTab, setActiveTab] = useState<'reading' | 'conversation'>('reading');

  // Practice Mode State
  const [targetTitle, setTargetTitle] = useState("");
  const [targetText, setTargetText] = useState("");
  const [currentSelection, setCurrentSelection] = useState("");
  const [analyzedText, setAnalyzedText] = useState("");
  const [isPracticePlaying, setIsPracticePlaying] = useState(false);
  const [isTTSProcessing, setIsTTSProcessing] = useState(false); // Track TTS processing state
  const [manualTopic, setManualTopic] = useState("");
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCaching, setIsCaching] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false); // Track analysis status
  const [showGuide, setShowGuide] = useState(false); // State for Pronunciation Guide
  const targetTextRef = useRef(targetText);
  const activeAnalysisTextRef = useRef(""); // Stores the text (full or selection) being analyzed during recording
  
  // Audio Refs for Pause/Resume
  const ttsAudioContextRef = useRef<AudioContext | null>(null);
  const practiceSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const practiceAudioBufferRef = useRef<AudioBuffer | null>(null);
  const practiceStartTimeRef = useRef<number>(0);
  const practicePausedAtRef = useRef<number>(0);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Practice Recorder State
  const [isPracticeRecording, setIsPracticeRecording] = useState(false);
  const [practiceRecorder] = useState(() => new AudioRecorder());
  const practiceAudioChunks = useRef<string[]>([]);
  const [practiceFeedback, setPracticeFeedback] = useState<PronunciationFeedback | null>(null);

  // IPA Cache: Stores word -> { ipa, translation }
  const ipaCacheRef = useRef<Map<string, { ipa: string; translation: string }>>(new Map());
  
  // Word Selection Tooltip State
  const [selectedWordTooltip, setSelectedWordTooltip] = useState<{
    word: string;
    ipa: string | null;
    translation: string | null;
    x: number;
    y: number;
  } | null>(null);

  // Conversation Feedback Tooltip State
  const [feedbackTooltip, setFeedbackTooltip] = useState<{
    x: number;
    y: number;
    data: any;
  } | null>(null);

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
        // Reset height to auto to get the correct scrollHeight
        textareaRef.current.style.height = 'auto';
        const scrollHeight = textareaRef.current.scrollHeight;
        
        // We set the height to the scrollHeight. 
        // The CSS max-height: 100% on the textarea combined with the flexbox layout of the container
        // will ensure it doesn't overflow the screen, while 'overflow-y: auto' handles scrolling.
        const newHeight = Math.max(scrollHeight, 150);
        textareaRef.current.style.height = `${newHeight}px`;
    }
  }, []);

  useEffect(() => {
    targetTextRef.current = targetText;
    setPracticeFeedback(null); // Clear feedback when text changes
    setCurrentSelection(""); // Clear selection state when text changes
    
    // Stop any playing audio if text changes
    if (practiceSourceRef.current) {
        practiceSourceRef.current.stop();
        practiceSourceRef.current = null;
    }
    // Clear audio buffer cache
    practiceAudioBufferRef.current = null;
    practicePausedAtRef.current = 0;
    setIsPracticePlaying(false);
    setIsTTSProcessing(false);

    // Auto-resize textarea to fit content
    adjustTextareaHeight();

  }, [targetText, adjustTextareaHeight]);
  
  // Re-adjust height on window resize
  useEffect(() => {
      const handleResize = () => {
          adjustTextareaHeight();
      };
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
  }, [adjustTextareaHeight]);


  useEffect(() => {
    const apiKey = process.env.API_KEY as string;
    if (apiKey) {
      setAi(new GoogleGenAI({ apiKey }));
    } else {
      console.error('Missing API_KEY');
    }
  }, []);

  const isQuotaError = (e: any) => {
    if (!e) return false;
    // If e is a string, check content
    if (typeof e === 'string') {
        return e.includes('429') || e.includes('RESOURCE_EXHAUSTED');
    }
    // Check various properties that might contain the error info
    return (
      e.message?.includes('429') || 
      e.message?.includes('RESOURCE_EXHAUSTED') || 
      e.status === 'RESOURCE_EXHAUSTED' ||
      (e.error && (
          e.error.code === 429 || 
          e.error.status === 'RESOURCE_EXHAUSTED' ||
          e.error.message?.includes('RESOURCE_EXHAUSTED')
      ))
    );
  };

  const handleOpError = (e: any) => {
    // Check for common rate limit / quota errors
    const isQuota = isQuotaError(e);

    if (isQuota) {
      console.warn("Quota limit reached:", e);
    } else {
      console.error("Operation error:", e);
    }

    let msg = "An error occurred. Please try again.";
    if (isQuota) {
      msg = "Quota limit reached. Please wait a moment before trying again.";
    }
    setPracticeError(msg);
    // Auto-clear after 5 seconds
    setTimeout(() => setPracticeError(null), 5000);
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
    const { addTurn, updateLastTurn } = useLogStore.getState();

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
        const turns = useLogStore.getState().turns;
        const last = turns[turns.length - 1];
        if (last && last.role === 'agent' && !last.isFinal) {
          updateLastTurn({
            text: last.text + text,
            isFinal,
          });
        } else {
          addTurn({ role: 'agent', text, isFinal });
        }
      };

    client.on('inputTranscription', handleInputTranscription);
    client.on('outputTranscription', handleOutputTranscription);

    return () => {
      client.off('inputTranscription', handleInputTranscription);
      client.off('outputTranscription', handleOutputTranscription);
    };
  }, [client]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  // --- Practice Mode Handlers ---

  const handleGenerateTopic = async () => {
    if (!ai) return;
    setIsGenerating(true);
    setPracticeError(null);
    setTargetText(""); 
    setTargetTitle("");

    try {
      let prompt = "";
      const jsonInstruction = `\n\nProvide the response strictly as a JSON object with keys "title" and "text".\nExample:\n{\n  "title": "Java Streams",\n  "text": "Java streams provide..."\n}`;

      if (manualTopic.trim()) {
         prompt = `Generate a cohesive, educational paragraph of 100 to 200 words specifically about "${manualTopic.trim()}". The text should be suitable for reading practice. Do not use bullet points or markdown formatting in the 'text' field.${jsonInstruction}`;
      } else {
         const javaSubTopics = [
            "Java Concurrency", "Java Streams API", "Java Collections Framework", 
            "Java Virtual Machine (JVM) Architecture", "Spring Boot Basics", 
            "Java Garbage Collection", "Java Generics", "Java Multithreading",
            "Java Annotations", "Java Reflection API","Object-Oriented Programming (OOP)",
"Classes and Objects",
"Inheritance",
"Polymorphism",
"Encapsulation",
"Interfaces and Abstract Classes",
"Collections Framework",
"List, Set, Map interfaces",
"ArrayList, LinkedList, HashMap",
"Streams API",
"Lambda Expressions",
"Functional Interfaces",
"Exception Handling",
"Try-Catch-Finally",
"Custom Exceptions",
"Multithreading",
"Thread Management",
"Synchronization",
"Locks and ReentrantLock",
"Concurrent Collections",
"Generics",
"Type Parameters",
"Wildcards",
"Annotations",
"Reflection API",
"Spring Framework",
"Spring Boot",
"Spring MVC",
"Spring Data",
"Spring WebFlux",
"Reactive Programming",
"Project Reactor",
"RxJava",
"Mono and Flux",
"REST APIs",
"HTTP Methods and Status Codes",
"JSON Processing",
"Jackson Library",
"GSON",
"Microservices Architecture",
"Service-to-Service Communication",
"Circuit Breaker Pattern",
"Hystrix",
"Resilience4j",
"API Gateway",
"Service Discovery",
"Load Balancing",
"Database Access",
"JDBC",
"JPA and Hibernate",
"Connection Pooling",
"SQL and Query Optimization",
"Transaction Management",
"ACID Properties",
"Caching Strategies",
"Redis Integration",
"Memcached",
"Message Queues",
"RabbitMQ",
"Apache Kafka",
"Testing",
"Unit Testing with JUnit",
"Mockito",
"Integration Testing",
"Test Containers",
"Performance Testing",
"Security",
"Authentication and Authorization",
"Spring Security",
"JWT Tokens",
"OAuth 2.0",
"SSL/TLS",
"Encryption and Hashing",
"Logging",
"SLF4J",
"Logback",
"Log Aggregation",
"Monitoring and Metrics",
"Micrometer",
"Prometheus",
"Distributed Tracing",
"Jaeger",
"Cloud Deployment",
"Docker",
"Kubernetes",
"AWS Services",
"AWS ECS",
"AWS EKS",
"AWS Lambda",
"CI/CD Pipelines",
"DevSecOps",
"Maven",
"Gradle",
"Git Version Control",
"API Documentation",
"OpenAPI/Swagger",
"Design Patterns",
"Singleton Pattern",
"Factory Pattern",
"Builder Pattern",
"Observer Pattern",
"Strategy Pattern",
"Decorator Pattern",
"Adapter Pattern",
"Proxy Pattern",
"Saga Pattern",
"CQRS Pattern",
"Event Sourcing",
"Domain-Driven Design (DDD)",
"Dependency Injection",
"Inversion of Control (IoC)",
"SOLID Principles",
"Clean Code",
"Code Review Practices",
"Regular Expressions",
"Date and Time API",
"Java 8+ Features",
"Java 11+ Features",
"Records",
"Sealed Classes",
"Text Blocks",
"Blockchain Integration",
"Smart Contracts Integration",
"Web3 Libraries"
         ];
         const randomSubTopic = javaSubTopics[Math.floor(Math.random() * javaSubTopics.length)];
         prompt = `Search for recent trending topics in Java programming, specifically focusing on "${randomSubTopic}". Randomly select one specific aspect. Write a cohesive, educational paragraph of 100 to 200 words explaining this topic. The text should be suitable for reading practice. Do not use bullet points or markdown formatting in the 'text' field.${jsonInstruction}`;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
            role: 'user',
            parts: [{ text: prompt }]
        }],
        config: {
           tools: [{googleSearch: {}}]
        }
      });

      const text = response.text;
      if (text) {
        try {
            // Cleanup potential markdown blocks
            let cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(cleanJson);
            
            if (data.title) setTargetTitle(data.title);
            if (data.text) setTargetText(data.text);
            
            // Handle case where text is plain string if JSON structure mismatch (defensive)
            if (!data.text && !data.title && typeof data === 'string') {
                setTargetText(data);
            }
        } catch (e) {
            // Fallback for non-JSON response (e.g. from Search tool direct output)
            setTargetText(text);
        }
      }
    } catch (e) {
      handleOpError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePracticeTTS = async () => {
    if (!ai || !targetText) return;
    setPracticeError(null);

    // Reuse or create AudioContext to ensure time continuity for pause/resume
    if (!ttsAudioContextRef.current || ttsAudioContextRef.current.state === 'closed') {
        ttsAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    }
    const audioContext = ttsAudioContextRef.current;
    
    // Resume context if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    // 1. Pause Logic
    if (isPracticePlaying) {
        if (practiceSourceRef.current) {
            try {
                practiceSourceRef.current.stop();
            } catch (e) {
                // ignore if already stopped
            }
            practiceSourceRef.current = null;
        }
        // Record where we paused relative to the start time of this playback session
        practicePausedAtRef.current = audioContext.currentTime - practiceStartTimeRef.current;
        setIsPracticePlaying(false);
        setIsTTSProcessing(false);
        return;
    }

    // 2. Resume Logic (if audio is buffered and we have a pause position)
    if (practiceAudioBufferRef.current && practicePausedAtRef.current > 0 && practicePausedAtRef.current < practiceAudioBufferRef.current.duration) {
        const source = audioContext.createBufferSource();
        source.buffer = practiceAudioBufferRef.current;
        source.connect(audioContext.destination);
        source.onended = () => {
             // We don't necessarily clear playing state here if we want to allow re-play or other logic,
             // but typically we should. However, since manual pause triggers onended too (sometimes),
             // we rely on the click handler to toggle state.
             // For natural end:
             if (audioContext.currentTime >= practiceStartTimeRef.current + (practiceAudioBufferRef.current?.duration || 0) - 0.2) {
                setIsPracticePlaying(false);
                practicePausedAtRef.current = 0;
             }
        };
        
        practiceSourceRef.current = source;
        // Recalculate startTime so that (currentTime - startTime) equals the pausedAt point
        // startTime = currentTime - pausedAt
        practiceStartTimeRef.current = audioContext.currentTime - practicePausedAtRef.current;
        
        source.start(0, practicePausedAtRef.current);
        setIsPracticePlaying(true);
        return;
    }

    // 3. New Start Logic
    try {
        setIsTTSProcessing(true);
        // Reset offsets
        practicePausedAtRef.current = 0;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-tts',
            contents: [{ parts: [{ text: targetText }] }],
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
            practiceAudioBufferRef.current = buffer;

            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            
            // Set start time relative to current context time
            practiceStartTimeRef.current = audioContext.currentTime;

            source.onended = () => {
                if (audioContext.currentTime >= practiceStartTimeRef.current + buffer.duration - 0.2) {
                     setIsPracticePlaying(false);
                     practicePausedAtRef.current = 0;
                }
            };

            practiceSourceRef.current = source;
            source.start();
            setIsPracticePlaying(true);
        }
    } catch (e) {
        handleOpError(e);
        setIsPracticePlaying(false);
    } finally {
        setIsTTSProcessing(false);
    }
  };

  const analyzePronunciation = async () => {
      const textToAnalyze = activeAnalysisTextRef.current;
      if (!ai || !textToAnalyze || practiceAudioChunks.current.length === 0) return;
      
      setIsAnalyzing(true);
      
      try {
          // 1. Reconstruct raw PCM from base64 chunks
          const allChunks = practiceAudioChunks.current.map(chunk => base64ToArrayBuffer(chunk));
          const totalLength = allChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
          const pcmBuffer = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of allChunks) {
              pcmBuffer.set(new Uint8Array(chunk), offset);
              offset += chunk.byteLength;
          }
          
          // 2. Add WAV Header
          // AudioRecorder defaults to 16000Hz, 1 channel
          const sampleRate = 16000;
          const wavHeader = createWavHeader(sampleRate, totalLength);
          const wavFile = new Uint8Array(wavHeader.byteLength + totalLength);
          wavFile.set(new Uint8Array(wavHeader), 0);
          wavFile.set(pcmBuffer, wavHeader.byteLength);

          // 3. Convert back to Base64
          const fullBase64 = arrayBufferToBase64(wavFile.buffer);

          const prompt = `
          The user is practicing reading the following text: "${textToAnalyze}".
          Analyze the user's pronunciation from the audio.
          For any mispronounced words (marked as "needs_improvement" or "incorrect"), you MUST provide specific advice on articulation in the 'tongue_placement' field.
          Explain clearly how to position the tongue, lips, and jaw to produce the correct sound.

          Provide a JSON response with the following structure:
          {
            "overall_assessment": "string",
            "words": [
                {
                    "word": "string",
                    "accuracy": "good" | "needs_improvement" | "incorrect",
                    "feedback": "string",
                    "phonetic_spoken": "string (IPA of what the user said)",
                    "phonetic_target": "string (IPA of correct pronunciation)",
                    "tongue_placement": "string (Specific advice on tongue position, lip shape, and jaw movement)"
                }
            ]
          }
          `;
          
          const response = await ai.models.generateContent({
             model: 'gemini-2.5-flash',
             contents: [
                 {
                     parts: [
                         { text: prompt },
                         { inlineData: { mimeType: 'audio/wav', data: fullBase64 } }
                     ]
                 }
             ],
             config: {
                 responseMimeType: 'application/json',
             }
          });
          
          if (response.text) {
              const feedback = JSON.parse(response.text) as PronunciationFeedback;
              setPracticeFeedback(feedback);
              setAnalyzedText(textToAnalyze);
          }

      } catch (e) {
          handleOpError(e);
      } finally {
        setIsAnalyzing(false);
      }
  };

  const handlePracticeMicToggle = async () => {
      if (isPracticeRecording) {
          // Stop
          practiceRecorder.stop();
          practiceRecorder.off('data');
          setIsPracticeRecording(false);
          
          // Analyze
          await analyzePronunciation();
      } else {
          // Start
          setPracticeFeedback(null);
          
          // Determine what text we are reading: Selection or Full Text
          const textToRead = currentSelection.trim().length > 0 ? currentSelection : targetText;
          activeAnalysisTextRef.current = textToRead;

          practiceAudioChunks.current = [];
          const onData = (base64: string) => {
              practiceAudioChunks.current.push(base64);
          };
          practiceRecorder.on('data', onData);
          await practiceRecorder.start();
          setIsPracticeRecording(true);
      }
  };

  const handleClearPractice = () => {
    setTargetText("");
    setTargetTitle("");
    setManualTopic("");
    setCurrentSelection("");
    setAnalyzedText("");
    setPracticeFeedback(null);
    setPracticeError(null);
    
    // Stop Playback
    if (practiceSourceRef.current) {
        try {
            practiceSourceRef.current.stop();
        } catch(e) {}
        practiceSourceRef.current = null;
    }
    practiceAudioBufferRef.current = null;
    practicePausedAtRef.current = 0;
    setIsPracticePlaying(false);
    setIsTTSProcessing(false);

    // Stop Recording
    if (isPracticeRecording) {
        practiceRecorder.stop();
        practiceRecorder.off('data');
        setIsPracticeRecording(false);
    }
  };

  // --- IPA Caching & Tooltip ---
  
  const fetchIPA = async (text: string) => {
      if (!ai || !text) return;
      setIsCaching(true);
      
      try {
          // Filter out words already in cache to save tokens
          const words = text.split(/\s+/).map(w => w.replace(/[^\w']/g, "").toLowerCase()).filter(w => w.length > 0);
          const uniqueWords = [...new Set(words)];
          const wordsToFetch = uniqueWords.filter(w => !ipaCacheRef.current.has(w));
          
          if (wordsToFetch.length === 0) {
              setIsCaching(false);
              return;
          }

          // Chunk requests if too many words (simple check)
          const chunk = wordsToFetch.slice(0, 50); // limit to 50 words per request

          const prompt = `
            Return a JSON object where keys are the English words from the list below and values are objects containing the 'ipa' (International Phonetic Alphabet) pronunciation and 'spanish_translation'.
            Words: ${chunk.join(', ')}
            Example format:
            {
              "hello": { "ipa": "/həˈləʊ/", "spanish_translation": "hola" }
            }
          `;

          const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: [{ parts: [{ text: prompt }] }],
              config: { responseMimeType: 'application/json' }
          });
          
          if (response.text) {
              // Basic cleanup of markdown code blocks if present (defensive)
              let cleanJson = response.text.trim();
              if (cleanJson.startsWith('```json')) {
                cleanJson = cleanJson.replace(/^`{3}json\n|`{3}$/g, '');
              } else if (cleanJson.startsWith('```')) {
                 cleanJson = cleanJson.replace(/^`{3}\n|`{3}$/g, '');
              }

              try {
                  const mapData = JSON.parse(cleanJson);
                  Object.entries(mapData).forEach(([word, data]: [string, any]) => {
                      ipaCacheRef.current.set(word.toLowerCase(), {
                          ipa: data.ipa || "",
                          translation: data.spanish_translation || ""
                      });
                  });
              } catch (parseErr) {
                 if (parseErr instanceof SyntaxError) {
                    console.warn("Truncated JSON response in background fetch, skipping chunk.");
                 } else {
                    console.warn("JSON parse error in background fetch:", parseErr);
                 }
              }
          }
      } catch (e) {
         // Background fetch failed, just log warning to avoid disrupting UI
         console.warn("Background IPA fetch failed:", e);
      } finally {
         setIsCaching(false);
      }
  };

  // Debounce the IPA fetch
  const debouncedFetchIPA = useMemo(
      () => debounce((text: string) => fetchIPA(text), 1000),
      [ai] // Re-create if AI client changes
  );

  useEffect(() => {
      if (targetText && ai) {
          debouncedFetchIPA(targetText);
      }
      return () => {
          debouncedFetchIPA.cancel();
      };
  }, [targetText, ai, debouncedFetchIPA]);

  const handleSelectionChange = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const target = e.currentTarget;
      const text = target.value.substring(target.selectionStart, target.selectionEnd);
      setCurrentSelection(text);
  };

  const handleTextareaKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    handleSelectionChange(e);
  };

  const handleTextareaMouseUp = async (e: React.MouseEvent<HTMLTextAreaElement>) => {
    // Track selection
    handleSelectionChange(e);

    const textarea = e.currentTarget;
    let start = textarea.selectionStart;
    let end = textarea.selectionEnd;
    const text = textarea.value;

    let selectedText = "";

    // "Smart Select" logic for single tap/click
    if (start === end) {
        // User tapped/clicked. Try to find the word boundary.
        const left = text.slice(0, start).search(/\S+$/);
        const right = text.slice(start).search(/\s/);
        
        if (left !== -1) {
            // Adjust start to beginning of word
            start = start - (text.slice(0, start).length - left);
            // Adjust end to end of word
            if (right === -1) {
                end = text.length;
            } else {
                end = end + right;
            }
            
            // Validate we actually found a word and not just whitespace
            const candidate = text.slice(start, end);
            if (/\w/.test(candidate)) {
                selectedText = candidate;
                // Programmatically select it to give visual feedback (optional, but good)
                textarea.setSelectionRange(start, end);
                setCurrentSelection(selectedText);
            }
        }
    } else {
        // Standard selection
        selectedText = text.substring(start, end).trim();
    }
    
    if (selectedText) {
        // Simple heuristic: single word only for IPA tooltip
        if (!selectedText.includes(' ')) {
            const word = selectedText.toLowerCase().replace(/[^\w']/g, "");
            
            // 1. Position Tooltip
            const windowWidth = window.innerWidth;
            let x = e.clientX;
            // Clamp X to prevent overflow for the selection tooltip
            // Assuming tooltip width is variable but around 200px max, and it's centered
            if (x < 50) x = 50;
            if (x > windowWidth - 50) x = windowWidth - 50;

            const y = e.clientY;

            // 2. Check Cache
            let data = ipaCacheRef.current.get(word);
            
            setSelectedWordTooltip({
               word: selectedText,
               ipa: data?.ipa || "Loading...",
               translation: data?.translation || "Loading...",
               x,
               y
            });

            // 3. Play Audio
             const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
             
             try {
                // If not cached, we might need to fetch manually for immediate feedback
                // but usually the background fetch catches it.
                // If "Loading...", we can trigger a targeted fetch.
                if (!data) {
                    const prompt = `
                      Return a JSON object for the word "${word}":
                      { "${word}": { "ipa": "...", "spanish_translation": "..." } }
                    `;
                    const response = await ai?.models.generateContent({
                         model: 'gemini-2.5-flash',
                         contents: [{ parts: [{ text: prompt }] }],
                         config: { responseMimeType: 'application/json' }
                    });
                    if (response?.text) {
                         const clean = response.text.replace(/```json|```/g, '').trim();
                         const json = JSON.parse(clean);
                         if (json[word]) {
                             data = { ipa: json[word].ipa, translation: json[word].spanish_translation };
                             ipaCacheRef.current.set(word, data);
                             setSelectedWordTooltip(prev => prev && prev.word === selectedText ? { ...prev, ipa: data!.ipa, translation: data!.translation } : prev);
                         }
                    }
                }
             
                const response = await ai?.models.generateContent({
                    model: 'gemini-2.5-flash-preview-tts',
                    contents: [{ parts: [{ text: selectedText }] }],
                    config: {
                        responseModalities: [Modality.AUDIO],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: { voiceName: 'Kore' },
                            },
                        },
                    },
                });

                const base64Audio = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
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
                    source.start();
                }

             } catch (e: any) {
                 if (isQuotaError(e)) {
                     setSelectedWordTooltip(prev => prev ? { ...prev, ipa: "Quota exceeded", translation: "Quota exceeded" } : null);
                 } else {
                    console.error("Selection TTS/IPA error", e);
                    setSelectedWordTooltip(prev => prev ? { ...prev, ipa: "Error", translation: "Error" } : null);
                 }
             }
        }
    }
  };
  
  const handleTextareaMouseDown = () => {
      setSelectedWordTooltip(null);
  };
  
  const renderFeedbackText = (text: string, words: any[]) => {
      // Create a map for fast lookup
      const feedbackMap = new Map(words.map(w => [w.word.toLowerCase(), w]));
      
      return text.split(/\s+/).map((word, index) => {
          const cleanWord = word.replace(/[^\w']/g, "").toLowerCase();
          const info = feedbackMap.get(cleanWord);
          
          if (info) {
              const className = `word-feedback accuracy-${info.accuracy}`;
              return (
                  <span 
                    key={index} 
                    className={className}
                    onMouseEnter={(e) => handleFeedbackEnter(e, info)}
                    onMouseLeave={handleFeedbackLeave}
                  >
                      {word}{' '}
                  </span>
              );
          }
          return <span key={index}>{word} </span>;
      });
  };

  const handleFeedbackEnter = (e: React.MouseEvent, data: any) => {
      // Tooltip width is ~350px.
      const tooltipWidth = 350; 
      const padding = 10;
      const windowWidth = window.innerWidth;
      
      let x = e.clientX;
      
      // If tooltip would go off right edge
      if (x + tooltipWidth > windowWidth) {
         x = windowWidth - tooltipWidth - padding;
      }
      
      // If pushed too far left (small screen)
      if (x < padding) {
         x = padding;
      }

      setFeedbackTooltip({
          x: x,
          y: e.clientY,
          data: data
      });
  };

  const handleFeedbackLeave = () => {
      setFeedbackTooltip(null);
  };

  const handleTabChange = (tab: 'reading' | 'conversation') => {
      if (tab !== 'conversation' && connected) {
          disconnect();
      }
      setActiveTab(tab);
  };

  return (
    <div className="streaming-console">
      <main>
          <div className="tab-navigation">
              <button 
                className={cn("tab-btn", { active: activeTab === 'reading' })}
                onClick={() => handleTabChange('reading')}
              >
                  Reading Text
              </button>
              <button 
                className={cn("tab-btn", { active: activeTab === 'conversation' })}
                onClick={() => handleTabChange('conversation')}
              >
                  Select a conversation category
              </button>
          </div>

      <div className="main-app-area">
      {activeTab === 'reading' && (
      <div className="practice-panel">
         <div className="practice-header">
            <input 
              className="topic-input" 
              type="text" 
              placeholder="Enter a topic (e.g., 'Java streams') or leave empty for random"
              value={manualTopic}
              onChange={(e) => setManualTopic(e.target.value)}
            />
            <button 
                className="practice-button" 
                onClick={handleGenerateTopic}
                disabled={isGenerating}
            >
                {isGenerating ? (
                    <>
                       <span className="icon">sync</span> Generating...
                    </>
                ) : (
                    <>
                       <span className="icon">lightbulb</span> Generate Text
                    </>
                )}
            </button>
            <button 
                className="practice-button guide-button" 
                onClick={() => setShowGuide(true)}
                title="Pronunciation Guide"
            >
                <span className="icon">help</span>
            </button>
         </div>
         {isCaching && (
             <div className="practice-status">Caching pronunciation...</div>
         )}
         {isAnalyzing && (
             <div className="practice-status analyzing">Analyzing speech...</div>
         )}
         {isTTSProcessing && (
             <div className="practice-status">Generating audio...</div>
         )}
         <div className="practice-input-container">
            <input
                type="text"
                className="practice-title-input"
                placeholder="Title (optional)"
                value={targetTitle}
                onChange={(e) => setTargetTitle(e.target.value)}
            />
            <textarea 
                ref={textareaRef}
                className="practice-textarea" 
                value={targetText}
                onChange={(e) => setTargetText(e.target.value)}
                placeholder="Enter English text here to practice..."
                rows={5}
                onMouseUp={handleTextareaMouseUp}
                onMouseDown={handleTextareaMouseDown}
                onKeyUp={handleTextareaKeyUp}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
            />
         </div>
         
         <div className="practice-controls">
            <button 
                className="practice-button" 
                onClick={handlePracticeTTS}
                disabled={!targetText || isTTSProcessing}
            >
                {isTTSProcessing ? (
                    <>
                    <span className="icon">hourglass_empty</span> Processing...
                    </>
                ) : isPracticePlaying ? (
                    <>
                    <span className="icon">pause</span> Pause
                    </>
                ) : (
                    <>
                    <span className="icon">volume_up</span> Listen
                    </>
                )}
            </button>
            
            <button
                className={cn("practice-button mic-toggle", { active: isPracticeRecording })}
                onClick={handlePracticeMicToggle}
                disabled={!targetText || isAnalyzing}
            >
                <span className="icon">mic</span>
                {isPracticeRecording ? "Stop & Check" : (currentSelection.trim().length > 0 ? "Read Selection" : "Read Aloud")}
            </button>
            
            <button 
                className="practice-button" 
                onClick={handleClearPractice}
                disabled={!targetText && !manualTopic}
            >
                <span className="icon">delete</span> Clear
            </button>
         </div>

         {practiceError && (
             <div className="practice-error">
                 <span className="icon">error</span> {practiceError}
             </div>
         )}
         
         {practiceFeedback && (
             <div className="pronunciation-feedback">
                 <div className="pronunciation-assessment">
                     <strong>Overall:</strong> {practiceFeedback.overall_assessment}
                 </div>
                 <div className="pronunciation-text">
                     {renderFeedbackText(analyzedText, practiceFeedback.words)}
                 </div>
             </div>
         )}
      </div>
      )}

      {activeTab === 'conversation' && (
          <>
            {!connected ? (
                <WelcomeScreen />
            ) : (
                <div className="transcription-view" ref={scrollRef}>
                    {turns.map((turn) => (
                        <div
                        key={turn.id}
                        className={cn('transcription-entry', turn.role, {
                            interim: !turn.isFinal,
                        })}
                        >
                        <div className="transcription-header">
                            <span className="transcription-source">
                            {turn.role === 'agent' ? 'Gemini' : 'You'}
                            </span>
                            <div className="transcription-meta">
                            <span className="transcription-timestamp">
                                {formatTimestamp(turn.timestamp)}
                            </span>
                            </div>
                        </div>

                        <div className="transcription-text-content">
                            {renderContent(turn.text)}
                        </div>
                        </div>
                    ))}
                </div>
            )}
            <ControlTray />
          </>
      )}

      </div>
      </main>

      {/* Tooltips */}
      {selectedWordTooltip && (
          <div 
            className="selection-tooltip"
            style={{ 
                left: selectedWordTooltip.x, 
                top: selectedWordTooltip.y 
            }}
          >
              <div className="tooltip-word">{selectedWordTooltip.word}</div>
              <div className="tooltip-ipa">{selectedWordTooltip.ipa}</div>
              <div className="tooltip-translation">{selectedWordTooltip.translation}</div>
          </div>
      )}

      {feedbackTooltip && (
          <div 
             className="feedback-tooltip"
             style={{
                 left: feedbackTooltip.x,
                 top: feedbackTooltip.y
             }}
          >
             <div className="feedback-header">{feedbackTooltip.data.word}</div>
             <div className="feedback-comparison">
                 <div className="comparison-item">
                     <span className="label">You said:</span>
                     <span className="ipa spoken">{feedbackTooltip.data.phonetic_spoken || "N/A"}</span>
                 </div>
                 <div className="comparison-item">
                     <span className="label">Target:</span>
                     <span className="ipa target">{feedbackTooltip.data.phonetic_target || "N/A"}</span>
                 </div>
             </div>
             <div className="feedback-body">
                 {feedbackTooltip.data.feedback}
             </div>
             {feedbackTooltip.data.tongue_placement && (
                 <div className="feedback-tips">
                     <span className="icon">tips_and_updates</span>
                     {feedbackTooltip.data.tongue_placement}
                 </div>
             )}
          </div>
      )}
      
      {showGuide && <PronunciationGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}
