/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { create } from 'zustand';
import {
  promptContent,
  PromptTemplate,
  PromptTopic,
} from './prompts';
import { DEFAULT_LIVE_API_MODEL, DEFAULT_VOICE } from './constants';
// FIX: Import FunctionDeclaration and FunctionResponseScheduling to define the FunctionCall type.
import {
  FunctionResponse,
  FunctionResponseScheduling,
  LiveServerToolCall,
  Schema,
} from '@google/genai';

/**
 * Settings
 */
export const useSettings = create<{
  systemPrompt: string;
  model: string;
  voice: string;
  setSystemPrompt: (prompt: string) => void;
  setModel: (model: string) => void;
  setVoice: (voice: string) => void;
}>(set => ({
  systemPrompt: promptContent['daily-life'].systemPrompt,
  model: DEFAULT_LIVE_API_MODEL,
  voice: DEFAULT_VOICE,
  setSystemPrompt: prompt => set({ systemPrompt: prompt }),
  setModel: model => set({ model }),
  setVoice: voice => set({ voice }),
}));


/**
 * UI
 */
export const useUI = create<{
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
}>(set => ({
  isSidebarOpen: false,
  toggleSidebar: () => set(state => ({ isSidebarOpen: !state.isSidebarOpen })),
}));

/**
 * Prompts
 */
export const usePrompts = create<{
  template: PromptTemplate;
  topics: PromptTopic[];
  customTopics: string;
  setTemplate: (template: PromptTemplate) => void;
  toggleTopic: (topicName: string) => void;
  setCustomTopics: (topics: string) => void;
}>(set => ({
  template: 'daily-life',
  topics: promptContent['daily-life'].topics,
  customTopics: '',
  setTemplate: (template: PromptTemplate) => {
    set({
      template,
      topics: promptContent[template].topics,
      customTopics: '', // Reset custom topics when template changes
    });
    useSettings.getState().setSystemPrompt(promptContent[template].systemPrompt);
  },
  toggleTopic: (topicName: string) =>
    set(state => ({
      topics: state.topics.map(topic =>
        topic.name === topicName
          ? { ...topic, isEnabled: !topic.isEnabled }
          : topic,
      ),
    })),
  setCustomTopics: (topics: string) => set({ customTopics: topics }),
}));

// FIX: Define and export the FunctionCall interface. This was missing, causing import errors.
// Re-defined to avoid issues with `extends FunctionDeclaration` in this environment.
export interface FunctionCall {
  name: string;
  description?: string;
  parameters?: Schema;
  isEnabled: boolean;
  scheduling?: FunctionResponseScheduling;
}

/**
 * Logs
 */
export interface LiveClientToolResponse {
  functionResponses?: FunctionResponse[];
}
export interface GroundingChunk {
  web?: {
    // FIX: Make uri and title optional to match the SDK type.
    uri?: string;
    title?: string;
  };
}
export interface PronunciationFeedback {
  overall_assessment: string;
  words: Array<{
    word: string;
    accuracy: 'good' | 'needs_improvement' | 'incorrect';
    feedback: string;
    phonetic_spoken?: string;
    phonetic_target?: string;
    tongue_placement?: string;
  }>;
}

export interface GrammarFeedback {
  overall_assessment: string;
  corrections: Array<{
    original: string;
    corrected: string;
    explanation: string;
  }>;
}

export interface ConversationTurn {
  id: string;
  timestamp: Date;
  role: 'user' | 'agent' | 'system';
  text: string;
  isFinal: boolean;
  toolUseRequest?: LiveServerToolCall;
  toolUseResponse?: LiveClientToolResponse;
  groundingChunks?: GroundingChunk[];
  ipa?: string;
  pronunciationFeedback?: PronunciationFeedback;
  grammarFeedback?: GrammarFeedback;
}

export const useLogStore = create<{
  turns: ConversationTurn[];
  addTurn: (turn: Omit<ConversationTurn, 'timestamp' | 'id'>) => void;
  updateLastTurn: (update: Partial<ConversationTurn>) => void;
  updateTurnById: (id: string, update: Partial<ConversationTurn>) => void;
  clearTurns: () => void;
}>((set, get) => ({
  turns: [],
  addTurn: (turn: Omit<ConversationTurn, 'timestamp' | 'id'>) =>
    set(state => ({
      turns: [
        ...state.turns,
        { ...turn, id: crypto.randomUUID(), timestamp: new Date() },
      ],
    })),
  updateLastTurn: (update: Partial<Omit<ConversationTurn, 'timestamp'>>) => {
    set(state => {
      if (state.turns.length === 0) {
        return state;
      }
      const newTurns = [...state.turns];
      const lastTurn = { ...newTurns[newTurns.length - 1], ...update };
      newTurns[newTurns.length - 1] = lastTurn;
      return { turns: newTurns };
    });
  },
  updateTurnById: (id: string, update: Partial<ConversationTurn>) => {
    set(state => ({
      turns: state.turns.map(t => (t.id === id ? { ...t, ...update } : t)),
    }));
  },
  clearTurns: () => set({ turns: [] }),
}));